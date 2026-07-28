import { randomUUID } from 'node:crypto';

import { isRegistrationOpen } from '../campaign/config';
import type { Campaign, RaffleEntry } from '../db/types';
import { deriveReceiptToken, deriveVerificationToken, hashToken } from './tokens';
import { RATE_LIMIT_WINDOW_SECONDS, emailRequestLimit, ipRequestLimit } from './limits';
import {
  confirmRequestSchema,
  resendRequestSchema,
  verificationRequestSchema,
} from './validation';

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_SECONDS = 2 * 60;
export const MAX_VERIFICATION_SENDS = 3;

/**
 * Raised when the database reports that a verification link cannot be used:
 * unknown, already consumed, or expired. Anything else is a server fault and
 * must not be reported to a visitor as a broken link.
 */
export class RaffleLinkError extends Error {
  constructor(message = 'The verification link cannot be used') {
    super(message);
    this.name = 'RaffleLinkError';
  }
}

export interface VerificationToken {
  id: string;
  entryId: string;
  tokenHash: string;
  expiresAt: string;
  sendCount: number;
  lastSentAt: string | null;
  consumedAt: string | null;
}

export interface DeliveryRecord {
  entryId: string;
  kind: 'VERIFICATION' | 'RECEIPT';
  status: 'SENT' | 'FAILED';
  providerMessageId?: string | null;
  providerError?: string | null;
}

export interface ReceiptJob {
  id: string;
  entryId: string;
  email: string;
  number: bigint;
  /** Fences completion so an expired lease cannot overwrite a newer attempt. */
  leaseExpiresAt: string;
}

export interface ConfirmedVerification {
  entryId: string;
  email: string;
  locale: 'en' | 'ja';
  campaignSlug: string;
  number: bigint | number | string;
}

export type PendingEntryInput = Omit<
  RaffleEntry,
  'id' | 'created_at' | 'updated_at' | 'number' | 'verified_at' | 'receipt_token_hash' | 'state'
>;

export interface RaffleRepository {
  getCampaignBySlug(slug: string): Promise<Campaign | null>;
  findEntryByEmail(campaignId: string, email: string): Promise<RaffleEntry | null>;
  createPendingEntry(input: PendingEntryInput): Promise<RaffleEntry>;
  /** Resolves to null when the entry was verified in the meantime. */
  updatePendingEntry(entryId: string, changes: Partial<RaffleEntry>): Promise<RaffleEntry | null>;
  getLatestVerificationToken(entryId: string): Promise<VerificationToken | null>;
  createVerificationToken(token: VerificationToken): Promise<VerificationToken>;
  /**
   * Atomically consumes one send allowance for a token. The cooldown and the
   * per-token ceiling live in the database so two concurrent submissions can
   * never both observe the same `send_count` and both send.
   */
  claimVerificationSend(
    tokenId: string,
    maxSends: number,
    cooldownSeconds: number,
  ): Promise<boolean>;
  recordDelivery(delivery: DeliveryRecord): Promise<void>;
  /** Throws {@link RaffleLinkError} when the link itself is unusable. */
  confirmVerification(
    tokenHash: string,
    receiptTokenHash: string,
    eventSlug: string,
  ): Promise<ConfirmedVerification | null>;
  claimReceiptJob(entryId: string): Promise<ReceiptJob | null>;
  completeReceiptJob(job: ReceiptJob, result: { sent: boolean; error?: string }): Promise<void>;
  /**
   * Queues a message the inline send could not deliver so the retry worker
   * takes it over. A send allowance is spent on the message, not on the
   * attempt, so a provider outage must not cost a visitor one of their three.
   */
  armOutboxJob(entryId: string, kind: 'VERIFICATION' | 'RECEIPT', error: string): Promise<void>;
  /** Marks a queued copy as delivered once an inline send got there first. */
  settleOutboxJob(entryId: string, kind: 'VERIFICATION' | 'RECEIPT'): Promise<void>;
}

export interface RaffleMailer {
  sendVerification(input: {
    eventSlug: string;
    email: string;
    token: string;
    locale: 'en' | 'ja';
  }): Promise<{ id?: string }>;
  sendReceipt(input: {
    eventSlug: string;
    email: string;
    number: bigint;
    receiptToken: string;
    locale: 'en' | 'ja';
  }): Promise<{ id?: string }>;
}

export interface TurnstileVerifier {
  verify(token: string, remoteIp?: string): Promise<boolean>;
}

export interface RaffleRateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export type RaffleRequestResult =
  | { accepted: true }
  | { accepted: false; reason: 'invalid' | 'closed' | 'rate_limited' | 'turnstile' };

export interface RaffleServiceDependencies {
  repository: RaffleRepository;
  mailer: RaffleMailer;
  turnstile: TurnstileVerifier;
  rateLimiter: RaffleRateLimiter;
  verificationTokenSecret: string;
  receiptTokenSecret: string;
  now?: () => Date;
  onDeliveryError?: (error: unknown) => void;
  /** Defaults come from the environment; tests inject them directly. */
  limits?: { email: number; ip: number };
}

export class RaffleService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: RaffleServiceDependencies) {
    if (!dependencies.verificationTokenSecret || !dependencies.receiptTokenSecret) {
      throw new Error('Raffle token secrets are not configured');
    }
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Accepts unvalidated input; the schema is the type boundary. */
  async requestVerification(input: unknown): Promise<RaffleRequestResult> {
    const parsed = verificationRequestSchema.safeParse(input);
    if (!parsed.success) return { accepted: false, reason: 'invalid' };
    const request = parsed.data;

    if (!(await this.dependencies.turnstile.verify(request.turnstileToken, request.ipAddress))) {
      return { accepted: false, reason: 'turnstile' };
    }

    // The schedule is checked before any allowance is spent, so a visitor who
    // arrives while registration is shut is not also charged their daily quota.
    const campaign = await this.dependencies.repository.getCampaignBySlug(request.eventSlug);
    if (!campaign || !isRegistrationOpen(campaign, this.now())) {
      return { accepted: false, reason: 'closed' };
    }

    if (!(await this.consumeRequestAllowance(request.eventSlug, request.email, request.ipAddress))) {
      return { accepted: false, reason: 'rate_limited' };
    }

    const existing = await this.dependencies.repository.findEntryByEmail(
      campaign.id,
      request.email,
    );
    // A verified address keeps its number and its profile untouched, and the
    // response is identical to a first submission so nobody can probe it.
    if (existing?.state === 'VERIFIED') return { accepted: true };

    const profile = {
      first_name: request.firstName,
      last_name: request.lastName,
      phone: request.phone,
      gender: request.gender,
      date_of_birth: request.dateOfBirth,
      country: request.country,
      region: request.region,
    };

    const entry = existing
      ? await this.dependencies.repository.updatePendingEntry(existing.id, {
          locale: request.locale,
          terms_version: campaign.terms_version,
          terms_consented_at: this.now().toISOString(),
          // Only fields the visitor supplied this time are written, so a second
          // submission with a blank form never erases an earlier profile.
          ...definedOnly(profile),
        })
      : await this.dependencies.repository.createPendingEntry({
          campaign_id: campaign.id,
          email: request.email,
          locale: request.locale,
          terms_version: campaign.terms_version,
          terms_consented_at: this.now().toISOString(),
          first_name: profile.first_name ?? null,
          last_name: profile.last_name ?? null,
          phone: profile.phone ?? null,
          gender: profile.gender ?? null,
          date_of_birth: profile.date_of_birth ?? null,
          country: profile.country ?? null,
          region: profile.region ?? null,
        });

    // A null update means the entry was verified between the read and the
    // write; that visitor already has a number and needs no further mail.
    if (!entry) return { accepted: true };

    const token = await this.activeOrNewToken(entry.id);
    await this.sendVerificationIfAllowed(request.eventSlug, entry, token);
    return { accepted: true };
  }

  async resendVerification(input: unknown): Promise<RaffleRequestResult> {
    const parsed = resendRequestSchema.safeParse(input);
    if (!parsed.success) return { accepted: false, reason: 'invalid' };
    const request = parsed.data;

    if (!(await this.dependencies.turnstile.verify(request.turnstileToken, request.ipAddress))) {
      return { accepted: false, reason: 'turnstile' };
    }

    const campaign = await this.dependencies.repository.getCampaignBySlug(request.eventSlug);
    if (!campaign || !isRegistrationOpen(campaign, this.now())) {
      return { accepted: false, reason: 'closed' };
    }

    if (!(await this.consumeRequestAllowance(request.eventSlug, request.email, request.ipAddress))) {
      return { accepted: false, reason: 'rate_limited' };
    }

    // Every outcome below returns the same acceptance, so a resend never
    // discloses whether an address is registered or already verified.
    const entry = await this.dependencies.repository.findEntryByEmail(campaign.id, request.email);
    if (!entry || entry.state === 'VERIFIED') return { accepted: true };

    const token = await this.dependencies.repository.getLatestVerificationToken(entry.id);
    if (!token || this.hasExpired(token)) return { accepted: true };

    await this.sendVerificationIfAllowed(request.eventSlug, entry, token);
    return { accepted: true };
  }

  async confirmVerification(
    input: unknown,
  ): Promise<{ number: bigint; receiptToken: string } | null> {
    const parsed = confirmRequestSchema.safeParse(input);
    if (!parsed.success) return null;
    const request = parsed.data;
    const receiptToken = deriveReceiptToken(request.token, this.dependencies.receiptTokenSecret);

    let confirmed: ConfirmedVerification | null;
    try {
      confirmed = await this.dependencies.repository.confirmVerification(
        hashToken(request.token),
        hashToken(receiptToken),
        request.eventSlug,
      );
    } catch (error) {
      // Only a database verdict that the link is unusable becomes a user-facing
      // invalid link. Everything else is a server fault and must surface.
      if (error instanceof RaffleLinkError) return null;
      throw error;
    }

    // The event slug was already enforced inside the transaction; this only
    // guards against an adapter returning an unrelated row.
    if (!confirmed || confirmed.campaignSlug !== request.eventSlug) return null;

    const number = BigInt(confirmed.number);
    await this.trySendReceipt(confirmed, number, receiptToken);
    return { number, receiptToken };
  }

  private async consumeRequestAllowance(
    eventSlug: string,
    email: string,
    ipAddress: string | undefined,
  ): Promise<boolean> {
    // The address limit is consumed first and the checks are sequential: an
    // address that is already over its limit must not be able to keep creating
    // per-address buckets, and a blocked caller must not burn a shared bucket.
    const limits = this.dependencies.limits ?? {
      email: emailRequestLimit(),
      ip: ipRequestLimit(),
    };

    const ipAllowed = await this.dependencies.rateLimiter.consume(
      `raffle:ip:${hashToken(`${eventSlug}:${ipAddress ?? 'unknown'}`)}`,
      limits.ip,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!ipAllowed) return false;

    return this.dependencies.rateLimiter.consume(
      `raffle:email:${hashToken(`${eventSlug}:${email}`)}`,
      limits.email,
      RATE_LIMIT_WINDOW_SECONDS,
    );
  }

  private hasExpired(token: VerificationToken): boolean {
    return new Date(token.expiresAt).getTime() <= this.now().getTime();
  }

  private async activeOrNewToken(entryId: string): Promise<VerificationToken> {
    const current = await this.dependencies.repository.getLatestVerificationToken(entryId);
    // An unexpired token is reused so a resend keeps sending the same link and
    // its send counters are never reset. A replacement is issued only on expiry.
    if (current && !this.hasExpired(current) && current.consumedAt === null) return current;
    return this.createVerificationToken(entryId);
  }

  private async createVerificationToken(entryId: string): Promise<VerificationToken> {
    const id = randomUUID();
    const raw = deriveVerificationToken(id, this.dependencies.verificationTokenSecret);
    const created = this.now();
    return this.dependencies.repository.createVerificationToken({
      id,
      entryId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(created.getTime() + TOKEN_LIFETIME_MS).toISOString(),
      sendCount: 0,
      lastSentAt: null,
      consumedAt: null,
    });
  }

  private async sendVerificationIfAllowed(
    eventSlug: string,
    entry: RaffleEntry,
    token: VerificationToken,
  ): Promise<void> {
    const allowed = await this.dependencies.repository.claimVerificationSend(
      token.id,
      MAX_VERIFICATION_SENDS,
      RESEND_COOLDOWN_SECONDS,
    );
    if (!allowed) return;

    try {
      const result = await this.dependencies.mailer.sendVerification({
        eventSlug,
        email: entry.email,
        token: deriveVerificationToken(token.id, this.dependencies.verificationTokenSecret),
        locale: entry.locale,
      });
      // A copy an earlier failure queued is now redundant; leaving it would send
      // the same link a second time.
      await this.dependencies.repository.settleOutboxJob(entry.id, 'VERIFICATION');
      await this.dependencies.repository.recordDelivery({
        entryId: entry.id,
        kind: 'VERIFICATION',
        status: 'SENT',
        providerMessageId: result.id ?? null,
      });
    } catch (error) {
      const message = messageOf(error);
      // The allowance is already spent, so the message must still arrive.
      // Queuing it comes first: the delivery record is bookkeeping, and letting
      // a failed insert skip this step is how a message gets lost outright.
      await this.dependencies.repository.armOutboxJob(entry.id, 'VERIFICATION', message);
      await this.dependencies.repository.recordDelivery({
        entryId: entry.id,
        kind: 'VERIFICATION',
        status: 'FAILED',
        providerError: message,
      });
    }
  }

  private async trySendReceipt(
    confirmed: ConfirmedVerification,
    number: bigint,
    receiptToken: string,
  ): Promise<void> {
    const { entryId, email, locale, campaignSlug } = confirmed;
    // The number is already durable, so a receipt that cannot be sent now stays
    // a retryable outbox job rather than failing the confirmation.
    try {
      const job = await this.dependencies.repository.claimReceiptJob(entryId);
      if (!job) return;

      // Only the provider call is treated as a delivery failure. If the send
      // succeeded and the bookkeeping afterwards throws, the error propagates
      // to the outer handler and the job stays leased until it expires, rather
      // than being recorded as a failure the visitor never experienced.
      let deliveryError: string | null = null;
      let providerMessageId: string | null = null;
      try {
        const result = await this.dependencies.mailer.sendReceipt({
          eventSlug: campaignSlug,
          email,
          number,
          receiptToken,
          locale,
        });
        providerMessageId = result.id ?? null;
      } catch (error) {
        deliveryError = messageOf(error);
      }

      // Completing the job comes first. It is what stops the message being sent
      // again; the delivery record is only bookkeeping, and ordering it ahead
      // would let a failed insert cost a duplicate receipt.
      await this.dependencies.repository.completeReceiptJob(
        job,
        deliveryError === null ? { sent: true } : { sent: false, error: deliveryError },
      );
      await this.dependencies.repository.recordDelivery({
        entryId,
        kind: 'RECEIPT',
        status: deliveryError === null ? 'SENT' : 'FAILED',
        providerMessageId,
        providerError: deliveryError,
      });
    } catch (error) {
      this.dependencies.onDeliveryError?.(error);
    }
  }
}

function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'mail provider failed';
}
