import { randomUUID } from 'node:crypto';

import { isRegistrationOpen } from '../campaign/config';
import type { Campaign, RaffleEntry } from '../db/types';
import { deriveReceiptToken, deriveVerificationToken, hashToken } from './tokens';
import {
  RATE_LIMIT_WINDOW_SECONDS,
  emailRequestLimit,
  ipRequestLimit,
  lookupEmailRequestLimit,
  lookupIpRequestLimit,
} from './limits';
import {
  confirmRequestSchema,
  lookupRequestSchema,
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
  /**
   * Puts a verified entry back to PENDING so the same address can rehearse
   * the whole journey again. Guarded by `is_test = true` in the query itself
   * — not only in the caller's logic — so this can never reopen a real
   * visitor's issued number even if that check were ever missed upstream.
   * Resolves to null if the entry was not (or no longer) a test entry.
   */
  resetTestEntry(entryId: string): Promise<RaffleEntry | null>;
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
  }): Promise<{ id?: string }>;
  sendReceipt(input: {
    eventSlug: string;
    email: string;
    number: bigint;
    receiptToken: string;
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
  // `test_address_conflict` is the one refusal a visitor can never see: it is
  // only reachable from a verified operator session asking to rehearse with an
  // address a real entrant already used.
  | {
      accepted: false;
      reason:
        | 'invalid'
        | 'closed'
        // Split so the caller can tell a visitor the true cause: a shared
        // venue network is nothing this address can do anything about, but
        // this address having asked several times today is — and "switch to
        // mobile data" is actively wrong advice for the second one.
        | 'rate_limited_network'
        | 'rate_limited_address'
        | 'turnstile'
        | 'test_address_conflict';
    };

/**
 * "Find my number": deliberately not shaped like {@link RaffleRequestResult}.
 * That type never discloses whether accepting means anything happened, on
 * purpose — this one exists specifically to disclose a number, so `found`
 * carries the number rather than hiding behind a uniform acceptance. What it
 * still will not disclose is the difference between "no such address" and
 * "registered but not verified yet" — both answer `not_found`, so a lookup
 * cannot be used to learn who has entered but not yet confirmed.
 */
export type RaffleLookupResult =
  | { found: true; number: bigint }
  | {
      found: false;
      reason?: 'invalid' | 'rate_limited_network' | 'rate_limited_address' | 'turnstile';
    };

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
  /**
   * A separate bucket pair from `limits`, on purpose — see the comment on
   * `lookupIpRequestLimit`. Defaults come from the environment; tests inject
   * them directly.
   */
  lookupLimits?: { email: number; ip: number };
  /**
   * Re-verifies an `isTest` claim against a real, current operator session.
   * A request that claims test mode without this resolving `true` is always
   * treated as an ordinary entry — the flag is never trusted on its own.
   * Omitted in tests that do not exercise test mode, which makes every claim
   * resolve to `false` by default (fail closed).
   */
  verifyOperatorSession?: () => Promise<boolean>;
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

    // Never trusted on the client's say-so alone: a claimed `isTest` only
    // takes effect once a real, current operator session is confirmed here.
    // Anyone else asking for it silently gets the ordinary flow instead of an
    // error, so the request behaves exactly like one that never sent the flag.
    const isTest = request.isTest === true && (await this.verifiedOperatorTestMode());

    // A verified test-mode request skips the challenge entirely: the operator
    // is already authenticated, and the form never even renders the widget
    // for it, so there is no token to check.
    if (!isTest) {
      if (!request.turnstileToken) return { accepted: false, reason: 'invalid' };
      if (!(await this.dependencies.turnstile.verify(request.turnstileToken, request.ipAddress))) {
        return { accepted: false, reason: 'turnstile' };
      }
    }

    // The schedule is checked before any allowance is spent, so a visitor who
    // arrives while registration is shut is not also charged their daily quota.
    // A verified test-mode request is exempt: an operator rehearsing the flow
    // needs it to work before opening and after closing, not only inside the
    // window real visitors get.
    const campaign = await this.dependencies.repository.getCampaignBySlug(request.eventSlug);
    if (!campaign || (!isTest && !isRegistrationOpen(campaign, this.now()))) {
      return { accepted: false, reason: 'closed' };
    }

    if (!isTest) {
      const limited = await this.consumeRequestAllowance(
        request.eventSlug,
        request.email,
        request.ipAddress,
      );
      if (limited) {
        return { accepted: false, reason: limited === 'ip' ? 'rate_limited_network' : 'rate_limited_address' };
      }
    }

    const existing = await this.dependencies.repository.findEntryByEmail(
      campaign.id,
      request.email,
    );

    // One entry exists per address per campaign, so a rehearsal and a real
    // entry cannot share one. Rather than let a rehearsal overwrite a real
    // entrant's row — which would move them to the test number range and drop
    // them from the draw, the counts and the export without either party
    // noticing — the rehearsal is refused. The caller is an authenticated
    // operator here, so saying plainly why discloses nothing.
    if (isTest && existing && !existing.is_test) {
      return { accepted: false, reason: 'test_address_conflict' };
    }

    let workingEntry = existing;
    if (existing?.state === 'VERIFIED') {
      // A verified address normally keeps its number and its profile
      // untouched, and the response is identical to a first submission so
      // nobody can probe it. A verified *test* entry is the one exception: it
      // is reset back to PENDING, both so an operator can run the whole
      // journey again from one address instead of burning a fresh one every
      // rehearsal, and so a real visitor is never turned away by an address
      // an operator happened to rehearse with.
      if (!existing.is_test) return { accepted: true };
      workingEntry = await this.dependencies.repository.resetTestEntry(existing.id);
      // Lost a race with something else touching this entry — treat it the
      // same as any other already-verified address.
      if (!workingEntry) return { accepted: true };
    }

    const profile = {
      first_name: request.firstName,
      last_name: request.lastName,
      phone: request.phone,
      gender: request.gender,
      date_of_birth: request.dateOfBirth,
      country: request.country,
      region: request.region,
    };

    // Recorded with the moment it was given, because proving consent is the
    // sender's job under CASL and "they ticked it at some point" is not proof.
    // A resubmission that leaves the box alone withdraws it — but only while
    // the entry is still PENDING: a verified address returns above, untouched.
    // Withdrawal after confirmation goes through the unsubscribe link in the
    // mail itself, which is what CASL actually requires; this form is not it.
    const marketing = {
      marketing_consent: request.marketingConsent,
      marketing_consent_at: request.marketingConsent ? this.now().toISOString() : null,
    };

    const entry = workingEntry
      ? await this.dependencies.repository.updatePendingEntry(workingEntry.id, {
          locale: 'en',
          terms_version: campaign.terms_version,
          terms_consented_at: this.now().toISOString(),
          // Never an OR against the stored flag: a rehearsal cannot reach a
          // real entry (refused above), and a real submission deliberately
          // takes the address back from a rehearsal, because a test entry is
          // disposable and a visitor's entry is not.
          is_test: isTest,
          ...marketing,
          // Only fields the visitor supplied this time are written, so a second
          // submission with a blank form never erases an earlier profile.
          ...definedOnly(profile),
        })
      : await this.dependencies.repository.createPendingEntry({
          campaign_id: campaign.id,
          email: request.email,
          locale: 'en',
          terms_version: campaign.terms_version,
          terms_consented_at: this.now().toISOString(),
          is_test: isTest,
          ...marketing,
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

    const isTest = request.isTest === true && (await this.verifiedOperatorTestMode());

    if (!isTest) {
      if (!request.turnstileToken) return { accepted: false, reason: 'invalid' };
      if (!(await this.dependencies.turnstile.verify(request.turnstileToken, request.ipAddress))) {
        return { accepted: false, reason: 'turnstile' };
      }
    }

    const campaign = await this.dependencies.repository.getCampaignBySlug(request.eventSlug);
    if (!campaign || (!isTest && !isRegistrationOpen(campaign, this.now()))) {
      return { accepted: false, reason: 'closed' };
    }

    if (!isTest) {
      const limited = await this.consumeRequestAllowance(
        request.eventSlug,
        request.email,
        request.ipAddress,
      );
      if (limited) {
        return { accepted: false, reason: limited === 'ip' ? 'rate_limited_network' : 'rate_limited_address' };
      }
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

  /**
   * "Find my number": discloses the number for a VERIFIED entry to whoever
   * holds the address, no proof of ownership beyond that. Decided and
   * accepted 2026-07-31 in place of emailing the number back, to avoid a
   * second message per lookup — see the register entry for the full
   * reasoning and the two rate limits that are its only backstop.
   *
   * Deliberately does not check `isRegistrationOpen`. A visitor who needs
   * this is most likely to need it around the draw itself — after intake has
   * closed and before results are announced — which is exactly the window a
   * schedule check would have refused it in.
   */
  async lookupNumber(input: unknown): Promise<RaffleLookupResult> {
    const parsed = lookupRequestSchema.safeParse(input);
    if (!parsed.success) return { found: false, reason: 'invalid' };
    const request = parsed.data;

    const isTest = request.isTest === true && (await this.verifiedOperatorTestMode());

    if (!isTest) {
      if (!request.turnstileToken) return { found: false, reason: 'invalid' };
      if (!(await this.dependencies.turnstile.verify(request.turnstileToken, request.ipAddress))) {
        return { found: false, reason: 'turnstile' };
      }
    }

    const campaign = await this.dependencies.repository.getCampaignBySlug(request.eventSlug);
    // An unknown event answers exactly like an address with no entry: there is
    // no further distinction worth drawing, and none that would not cost an
    // extra database round trip to make.
    if (!campaign) return { found: false };

    if (!isTest) {
      const limited = await this.consumeLookupAllowance(
        request.eventSlug,
        request.email,
        request.ipAddress,
      );
      if (limited) {
        return { found: false, reason: limited === 'ip' ? 'rate_limited_network' : 'rate_limited_address' };
      }
    }

    // The one thing this must not disclose beyond the accepted risk: whether
    // an address has entered but not yet confirmed. Both answer `found: false`
    // with no reason, identically to an address that never entered at all.
    const entry = await this.dependencies.repository.findEntryByEmail(campaign.id, request.email);
    if (!entry || entry.state !== 'VERIFIED' || entry.number === null) return { found: false };

    return { found: true, number: BigInt(entry.number) };
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

    // No second email. The confirmation link the visitor is holding already
    // returns here for good — see `issuedReceiptToken` — so a receipt would
    // duplicate a durable copy they have, at the cost of half the mail volume
    // on the day. `0010` stops the outbox row being armed for the same reason.
    return { number: BigInt(confirmed.number), receiptToken };
  }

  private async verifiedOperatorTestMode(): Promise<boolean> {
    return (await this.dependencies.verifyOperatorSession?.()) ?? false;
  }

  /**
   * Returns which bucket refused the request — `'ip'` or `'email'` — or `null`
   * if both allowed it, so the caller can tell a visitor the true cause
   * rather than a single generic "too many attempts".
   */
  private async consumeRequestAllowance(
    eventSlug: string,
    email: string,
    ipAddress: string | undefined,
  ): Promise<'ip' | 'email' | null> {
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
    if (!ipAllowed) return 'ip';

    const emailAllowed = await this.dependencies.rateLimiter.consume(
      `raffle:email:${hashToken(`${eventSlug}:${email}`)}`,
      limits.email,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    return emailAllowed ? null : 'email';
  }

  /**
   * A separate bucket pair from {@link consumeRequestAllowance}, on the same
   * IP and address axes but never sharing a key with it: a burst of lookups
   * must not spend the allowance a real entrant needs to submit or resend,
   * and the reverse.
   */
  /** Same `'ip' | 'email' | null` shape as {@link consumeRequestAllowance}. */
  private async consumeLookupAllowance(
    eventSlug: string,
    email: string,
    ipAddress: string | undefined,
  ): Promise<'ip' | 'email' | null> {
    const limits = this.dependencies.lookupLimits ?? {
      email: lookupEmailRequestLimit(),
      ip: lookupIpRequestLimit(),
    };

    const ipAllowed = await this.dependencies.rateLimiter.consume(
      `raffle:lookup-ip:${hashToken(`${eventSlug}:${ipAddress ?? 'unknown'}`)}`,
      limits.ip,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!ipAllowed) return 'ip';

    const emailAllowed = await this.dependencies.rateLimiter.consume(
      `raffle:lookup-email:${hashToken(`${eventSlug}:${email}`)}`,
      limits.email,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    return emailAllowed ? null : 'email';
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

}

function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'mail provider failed';
}
