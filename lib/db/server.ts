import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Campaign, RaffleEntry } from './types';
import { createRaffleMailer } from '../email/mailer';
import {
  EmailOutboxProcessor,
  type OutboxEntryContext,
  type OutboxJob,
  type OutboxOutcome,
  type OutboxRepository,
} from '../email/outbox';
import { SupabaseRateLimiter } from '../raffle/rate-limit';
import {
  RaffleLinkError,
  RaffleService,
  type ConfirmedVerification,
  type DeliveryRecord,
  type PendingEntryInput,
  type RaffleRepository,
  type ReceiptJob,
  type VerificationToken,
} from '../raffle/service';
import { getOperatorSession } from '../security/operator-session';
import { TurnstileVerifier } from '../security/turnstile';

// Supabase generated Database types are intentionally introduced with the
// deployment schema in a later task; this adapter is server-only in the meantime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseClient = SupabaseClient<any>;

/** SQLSTATE raised by `confirm_raffle_verification` for an unusable link. */
const UNUSABLE_LINK_SQLSTATE = 'RD001';
const UNIQUE_VIOLATION_SQLSTATE = '23505';
const RETRY_BACKOFF_SECONDS = 5 * 60;

export function createServiceRoleClient(): DatabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase server configuration is missing');
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function asToken(row: Record<string, unknown>): VerificationToken {
  return {
    id: String(row.id),
    entryId: String(row.entry_id),
    tokenHash: String(row.token_hash),
    expiresAt: String(row.expires_at),
    sendCount: Number(row.send_count),
    lastSentAt: typeof row.last_sent_at === 'string' ? row.last_sent_at : null,
    consumedAt: typeof row.consumed_at === 'string' ? row.consumed_at : null,
  };
}

export class SupabaseRaffleRepository implements RaffleRepository {
  constructor(private readonly client: DatabaseClient) {}

  async getCampaignBySlug(slug: string): Promise<Campaign | null> {
    const { data, error } = await this.client
      .from('campaigns')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data as Campaign | null;
  }

  async findEntryByEmail(campaignId: string, email: string): Promise<RaffleEntry | null> {
    // Addresses are normalized before they are ever written, so an exact match
    // is correct here. `ilike` must not be used: `_` and `%` in an address are
    // pattern wildcards and would match a different visitor's entry.
    const { data, error } = await this.client
      .from('raffle_entries')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data as RaffleEntry | null;
  }

  async createPendingEntry(input: PendingEntryInput): Promise<RaffleEntry> {
    const { data, error } = await this.client
      .from('raffle_entries')
      .insert({ ...input, state: 'PENDING' })
      .select()
      .single();
    if (!error) return data as RaffleEntry;

    // Two concurrent submissions of the same address both see no entry and both
    // insert. The unique index settles it; the loser reads the winner's row
    // instead of failing a request that did nothing wrong.
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION_SQLSTATE) throw error;
    const existing = await this.findEntryByEmail(input.campaign_id, input.email);
    if (!existing) throw error;
    return existing;
  }

  async updatePendingEntry(
    entryId: string,
    changes: Partial<RaffleEntry>,
  ): Promise<RaffleEntry | null> {
    // The state guard means a concurrent confirmation wins: the entry is
    // already verified and its profile must stay as it was submitted.
    const { data, error } = await this.client
      .from('raffle_entries')
      .update(changes)
      .eq('id', entryId)
      .eq('state', 'PENDING')
      .select()
      .maybeSingle();
    if (error) throw error;
    return (data as RaffleEntry | null) ?? null;
  }

  async resetTestEntry(entryId: string): Promise<RaffleEntry | null> {
    // `is_test = true` is part of the query, not just something the caller
    // checked first — a real visitor's issued number can never be reopened
    // through this path, regardless of what the calling code believes.
    const { data, error } = await this.client
      .from('raffle_entries')
      .update({ state: 'PENDING', number: null, verified_at: null, receipt_token_hash: null })
      .eq('id', entryId)
      .eq('is_test', true)
      .select()
      .maybeSingle();
    if (error) throw error;
    const entry = (data as RaffleEntry | null) ?? null;
    if (!entry) return null;

    // The entry is back to the state a brand-new one is in, so its outbox rows
    // have to go with it. `confirm_raffle_verification` queues the receipt with
    // `on conflict do nothing`, and a job is only claimable while it is unsent,
    // so a row left behind at SENT would make the next rehearsal issue a number
    // on screen and quietly send no receipt email at all.
    const { error: outboxError } = await this.client
      .from('email_outbox')
      .delete()
      .eq('entry_id', entryId);
    if (outboxError) throw outboxError;

    return entry;
  }

  async getLatestVerificationToken(entryId: string): Promise<VerificationToken | null> {
    const { data, error } = await this.client
      .from('verification_tokens')
      .select('*')
      .eq('entry_id', entryId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? asToken(data) : null;
  }

  async createVerificationToken(token: VerificationToken): Promise<VerificationToken> {
    const { data, error } = await this.client
      .from('verification_tokens')
      .insert({
        id: token.id,
        entry_id: token.entryId,
        token_hash: token.tokenHash,
        expires_at: token.expiresAt,
        send_count: token.sendCount,
        last_sent_at: token.lastSentAt,
        consumed_at: token.consumedAt,
      })
      .select()
      .single();
    if (error) throw error;
    return asToken(data);
  }

  async claimVerificationSend(
    tokenId: string,
    maxSends: number,
    cooldownSeconds: number,
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('claim_verification_send', {
      p_token_id: tokenId,
      p_max_sends: maxSends,
      p_cooldown_seconds: cooldownSeconds,
    });
    if (error) throw error;
    return data === true;
  }

  async recordDelivery(delivery: DeliveryRecord): Promise<void> {
    const { error } = await this.client.from('email_deliveries').insert({
      entry_id: delivery.entryId,
      kind: delivery.kind,
      provider_message_id: delivery.providerMessageId ?? null,
      provider_status: delivery.status,
      provider_error: delivery.providerError ?? null,
    });
    if (error) throw error;
  }

  async confirmVerification(
    tokenHash: string,
    receiptTokenHash: string,
    eventSlug: string,
  ): Promise<ConfirmedVerification | null> {
    const { data, error } = await this.client.rpc('confirm_raffle_verification', {
      p_token_hash: tokenHash,
      p_receipt_token_hash: receiptTokenHash,
      p_event_slug: eventSlug,
    });
    if (error) {
      if ((error as { code?: string }).code === UNUSABLE_LINK_SQLSTATE) {
        throw new RaffleLinkError(error.message);
      }
      // A rotated receipt secret (RD002) and any other failure are operational
      // faults; they must not be shown to a visitor as a broken link.
      throw error;
    }

    const { data: entry, error: entryError } = await this.client
      .from('raffle_entries')
      .select('id, email, number, campaigns!inner(slug)')
      .eq('receipt_token_hash', receiptTokenHash)
      .single();
    if (entryError || !entry) throw entryError ?? new Error('Confirmed entry was not found');

    const campaign = entry.campaigns as { slug: string } | { slug: string }[];
    return {
      entryId: entry.id,
      email: entry.email,
      campaignSlug: Array.isArray(campaign) ? campaign[0].slug : campaign.slug,
      number: data as string | number,
    };
  }

  async claimReceiptJob(entryId: string): Promise<ReceiptJob | null> {
    // The lease is taken by the same `FOR UPDATE SKIP LOCKED` routine the batch
    // processor uses, so a web request and a cron worker cannot both send it.
    const { data, error } = await this.client.rpc('claim_email_outbox_job_for_entry', {
      p_entry_id: entryId,
      p_kind: 'RECEIPT',
    });
    if (error) throw error;
    const claimed = (data as Array<{ id: string; lease_expires_at: string }> | null)?.[0];
    if (!claimed) return null;

    const { data: entry, error: entryError } = await this.client
      .from('raffle_entries')
      .select('email, number')
      .eq('id', entryId)
      .single();
    if (entryError) throw entryError;
    if (!entry || entry.number === null) return null;

    return {
      id: claimed.id,
      entryId,
      email: entry.email,
      number: BigInt(entry.number),
      leaseExpiresAt: claimed.lease_expires_at,
    };
  }

  async armOutboxJob(entryId: string, kind: 'VERIFICATION' | 'RECEIPT', error: string): Promise<void> {
    const { data, error: rpcError } = await this.client.rpc('arm_email_outbox_job', {
      p_entry_id: entryId,
      p_kind: kind,
      p_error: error,
    });
    if (rpcError) throw rpcError;
    // False means another worker holds a live lease on this entry's job, so the
    // message is already someone's responsibility. Anything else would be a
    // message quietly dropped, which is what this call exists to prevent.
    if (data !== true) {
      console.warn('Outbox job for entry %s (%s) was already leased', entryId, kind);
    }
  }

  async settleOutboxJob(entryId: string, kind: 'VERIFICATION' | 'RECEIPT'): Promise<void> {
    const { error } = await this.client.rpc('settle_email_outbox_job', {
      p_entry_id: entryId,
      p_kind: kind,
    });
    if (error) throw error;
  }

  async completeReceiptJob(job: ReceiptJob, result: { sent: boolean; error?: string }): Promise<void> {
    // Fenced by the lease this worker holds, so a worker whose lease already
    // expired cannot overwrite the outcome recorded by its replacement.
    const { error } = await this.client.rpc('complete_email_outbox_job', {
      p_job_id: job.id,
      p_lease_expires_at: job.leaseExpiresAt,
      p_outcome: result.sent ? 'SENT' : 'FAILED',
      p_error: result.error ?? null,
      p_retry_seconds: RETRY_BACKOFF_SECONDS,
    });
    if (error) throw error;
  }
}

export class SupabaseOutboxRepository implements OutboxRepository {
  constructor(private readonly client: DatabaseClient) {}

  async claimNextJob(): Promise<OutboxJob | null> {
    const { data, error } = await this.client.rpc('claim_email_outbox_job');
    if (error) throw error;
    const claimed = (
      data as Array<{
        id: string;
        entry_id: string;
        kind: 'VERIFICATION' | 'RECEIPT';
        attempt_count: number;
        lease_expires_at: string;
      }> | null
    )?.[0];
    if (!claimed) return null;

    return {
      id: claimed.id,
      entryId: claimed.entry_id,
      kind: claimed.kind,
      attemptCount: claimed.attempt_count,
      leaseExpiresAt: claimed.lease_expires_at,
    };
  }

  async getEntryContext(entryId: string): Promise<OutboxEntryContext | null> {
    const { data: entry, error } = await this.client
      .from('raffle_entries')
      .select('email, number, receipt_token_hash, campaigns!inner(slug)')
      .eq('id', entryId)
      .maybeSingle();
    if (error) throw error;
    if (!entry) return null;

    const { data: tokens, error: tokenError } = await this.client
      .from('verification_tokens')
      .select('id, expires_at, consumed_at')
      .eq('entry_id', entryId)
      .order('created_at', { ascending: false });
    if (tokenError) throw tokenError;

    const rows = (tokens ?? []) as Array<{
      id: string;
      expires_at: string;
      consumed_at: string | null;
    }>;
    const active = rows.find(
      (token) => token.consumed_at === null && new Date(token.expires_at).getTime() > Date.now(),
    );
    const campaign = entry.campaigns as { slug: string } | { slug: string }[];

    return {
      email: entry.email,
      campaignSlug: Array.isArray(campaign) ? campaign[0].slug : campaign.slug,
      number: entry.number === null ? null : BigInt(entry.number),
      receiptTokenHash: entry.receipt_token_hash,
      verificationTokenIds: rows.map((token) => token.id),
      activeVerificationTokenId: active?.id ?? null,
    };
  }

  async recordDelivery(delivery: DeliveryRecord): Promise<void> {
    const { error } = await this.client.from('email_deliveries').insert({
      entry_id: delivery.entryId,
      kind: delivery.kind,
      provider_message_id: delivery.providerMessageId ?? null,
      provider_status: delivery.status,
      provider_error: delivery.providerError ?? null,
    });
    if (error) throw error;
  }

  async completeJob(job: OutboxJob, result: OutboxOutcome): Promise<void> {
    const { error } = await this.client.rpc('complete_email_outbox_job', {
      p_job_id: job.id,
      p_lease_expires_at: job.leaseExpiresAt,
      p_outcome: result.status,
      p_error: result.status === 'SENT' ? null : result.error,
      p_retry_seconds: result.status === 'FAILED' ? result.retrySeconds : 0,
    });
    if (error) throw error;
  }
}

export function getEmailOutboxProcessor(): EmailOutboxProcessor {
  return new EmailOutboxProcessor({
    repository: new SupabaseOutboxRepository(createServiceRoleClient()),
    mailer: createRaffleMailer(),
    verificationTokenSecret: requiredSecret('VERIFICATION_TOKEN_SECRET'),
    receiptTokenSecret: requiredSecret('RECEIPT_TOKEN_SECRET'),
    onError: (error) => console.error('Outbox bookkeeping failed', error),
  });
}

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getRaffleService(): RaffleService {
  const client = createServiceRoleClient();
  return new RaffleService({
    repository: new SupabaseRaffleRepository(client),
    mailer: createRaffleMailer(),
    turnstile: new TurnstileVerifier(),
    rateLimiter: new SupabaseRateLimiter(client),
    verificationTokenSecret: requiredSecret('VERIFICATION_TOKEN_SECRET'),
    receiptTokenSecret: requiredSecret('RECEIPT_TOKEN_SECRET'),
    onDeliveryError: (error) => console.error('Receipt delivery could not be dispatched', error),
    verifyOperatorSession: async () => (await getOperatorSession()) !== null,
  });
}
