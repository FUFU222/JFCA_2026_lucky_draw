import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Campaign, RaffleEntry } from './types';
import { ResendRaffleMailer } from '../email/resend';
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
import { TurnstileVerifier } from '../security/turnstile';

// Supabase generated Database types are intentionally introduced with the
// deployment schema in a later task; this adapter is server-only in the meantime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseClient = SupabaseClient<any>;

/** SQLSTATE raised by `confirm_raffle_verification` for an unusable link. */
const UNUSABLE_LINK_SQLSTATE = 'RD001';
const RETRY_BACKOFF_MS = 5 * 60 * 1000;

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
    if (error) throw error;
    return data as RaffleEntry;
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
  ): Promise<ConfirmedVerification | null> {
    const { data, error } = await this.client.rpc('confirm_raffle_verification', {
      token_hash: tokenHash,
      receipt_token_hash: receiptTokenHash,
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
      .select('id, email, locale, number, campaigns!inner(slug)')
      .eq('receipt_token_hash', receiptTokenHash)
      .single();
    if (entryError || !entry) throw entryError ?? new Error('Confirmed entry was not found');

    const campaign = entry.campaigns as { slug: string } | { slug: string }[];
    return {
      entryId: entry.id,
      email: entry.email,
      locale: entry.locale,
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
    const claimed = (data as Array<{ id: string }> | null)?.[0];
    if (!claimed) return null;

    const { data: entry, error: entryError } = await this.client
      .from('raffle_entries')
      .select('email, number')
      .eq('id', entryId)
      .single();
    if (entryError) throw entryError;
    if (!entry || entry.number === null) return null;

    return { id: claimed.id, entryId, email: entry.email, number: BigInt(entry.number) };
  }

  async completeReceiptJob(jobId: string, result: { sent: boolean; error?: string }): Promise<void> {
    const now = Date.now();
    const { error } = await this.client
      .from('email_outbox')
      .update(
        result.sent
          ? {
              status: 'SENT',
              sent_at: new Date(now).toISOString(),
              leased_at: null,
              lease_expires_at: null,
              last_error: null,
            }
          : {
              status: 'FAILED',
              available_at: new Date(now + RETRY_BACKOFF_MS).toISOString(),
              leased_at: null,
              lease_expires_at: null,
              last_error: result.error ?? 'delivery failed',
            },
      )
      .eq('id', jobId);
    if (error) throw error;
  }
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
    mailer: new ResendRaffleMailer(),
    turnstile: new TurnstileVerifier(),
    rateLimiter: new SupabaseRateLimiter(client),
    verificationTokenSecret: requiredSecret('VERIFICATION_TOKEN_SECRET'),
    receiptTokenSecret: requiredSecret('RECEIPT_TOKEN_SECRET'),
    onDeliveryError: (error) => console.error('Receipt delivery could not be dispatched', error),
  });
}
