import { deriveReceiptToken, deriveVerificationToken, hashToken } from '../raffle/tokens';
import type { DeliveryRecord, RaffleMailer } from '../raffle/service';

export const OUTBOX_BATCH_LIMIT = 20;
const BASE_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 6 * 60 * 60;

export interface OutboxJob {
  id: string;
  entryId: string;
  kind: 'VERIFICATION' | 'RECEIPT';
  attemptCount: number;
  leaseExpiresAt: string;
}

/** Everything a job needs to become an addressed message. */
export interface OutboxEntryContext {
  email: string;
  locale: 'en' | 'ja';
  campaignSlug: string;
  number: bigint | null;
  receiptTokenHash: string | null;
  /** Ids of the entry's verification token rows, newest first. */
  verificationTokenIds: string[];
  activeVerificationTokenId: string | null;
}

export interface OutboxRepository {
  claimNextJob(): Promise<OutboxJob | null>;
  getEntryContext(entryId: string): Promise<OutboxEntryContext | null>;
  recordDelivery(delivery: DeliveryRecord): Promise<void>;
  completeJob(job: OutboxJob, result: { sent: boolean; error?: string; retrySeconds: number }): Promise<void>;
}

export interface OutboxRunSummary {
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * Retry backoff doubles per attempt and is capped, so a provider outage does
 * not turn into a per-minute retry storm across thousands of jobs.
 */
export function retryDelaySeconds(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(BASE_RETRY_SECONDS * 2 ** Math.min(exponent, 20), MAX_RETRY_SECONDS);
}

export class EmailOutboxProcessor {
  constructor(
    private readonly dependencies: {
      repository: OutboxRepository;
      mailer: RaffleMailer;
      verificationTokenSecret: string;
      receiptTokenSecret: string;
      onError?: (error: unknown) => void;
    },
  ) {
    if (!dependencies.verificationTokenSecret || !dependencies.receiptTokenSecret) {
      throw new Error('Raffle token secrets are not configured');
    }
  }

  async process(limit = OUTBOX_BATCH_LIMIT): Promise<OutboxRunSummary> {
    const summary: OutboxRunSummary = { claimed: 0, sent: 0, failed: 0 };

    for (let processed = 0; processed < limit; processed += 1) {
      const job = await this.dependencies.repository.claimNextJob();
      if (!job) break;
      summary.claimed += 1;

      const outcome = await this.deliver(job);
      if (outcome.sent) summary.sent += 1;
      else summary.failed += 1;
    }

    return summary;
  }

  private async deliver(job: OutboxJob): Promise<{ sent: boolean }> {
    let providerMessageId: string | null = null;
    let deliveryError: string | null = null;

    try {
      const context = await this.dependencies.repository.getEntryContext(job.entryId);
      if (!context) throw new Error('Outbox entry was not found');

      const result =
        job.kind === 'VERIFICATION'
          ? await this.sendVerification(context)
          : await this.sendReceipt(context);
      providerMessageId = result.id ?? null;
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : 'mail provider failed';
    }

    try {
      await this.dependencies.repository.recordDelivery({
        entryId: job.entryId,
        kind: job.kind,
        status: deliveryError === null ? 'SENT' : 'FAILED',
        providerMessageId,
        providerError: deliveryError,
      });
      await this.dependencies.repository.completeJob(job, {
        sent: deliveryError === null,
        error: deliveryError ?? undefined,
        retrySeconds: retryDelaySeconds(job.attemptCount),
      });
    } catch (error) {
      // The message may already be out. Leave the lease to expire rather than
      // recording an outcome we could not persist.
      this.dependencies.onError?.(error);
    }

    return { sent: deliveryError === null };
  }

  private async sendVerification(context: OutboxEntryContext) {
    const tokenId = context.activeVerificationTokenId;
    if (!tokenId) {
      // Nothing to resend: the link either expired or was already used. The job
      // is completed rather than retried forever.
      throw new Error('No active verification link remains for this entry');
    }

    return this.dependencies.mailer.sendVerification({
      eventSlug: context.campaignSlug,
      email: context.email,
      locale: context.locale,
      token: deriveVerificationToken(tokenId, this.dependencies.verificationTokenSecret),
    });
  }

  private async sendReceipt(context: OutboxEntryContext) {
    if (context.number === null || context.receiptTokenHash === null) {
      throw new Error('Receipt requested for an entry without an issued number');
    }

    const receiptToken = this.recoverReceiptToken(context);
    if (!receiptToken) {
      // Only a changed RECEIPT_TOKEN_SECRET can cause this. Say so plainly:
      // the entry keeps its number, but its permanent link cannot be rebuilt.
      throw new Error(
        'Receipt link cannot be derived for this entry; RECEIPT_TOKEN_SECRET may have changed',
      );
    }

    return this.dependencies.mailer.sendReceipt({
      eventSlug: context.campaignSlug,
      email: context.email,
      locale: context.locale,
      number: context.number,
      receiptToken,
    });
  }

  /**
   * Only the receipt token's hash is stored, so the raw value is rebuilt from
   * the verification token row that produced it and checked against that hash.
   */
  private recoverReceiptToken(context: OutboxEntryContext): string | null {
    for (const tokenId of context.verificationTokenIds) {
      const receiptToken = deriveReceiptToken(
        deriveVerificationToken(tokenId, this.dependencies.verificationTokenSecret),
        this.dependencies.receiptTokenSecret,
      );
      if (hashToken(receiptToken) === context.receiptTokenHash) return receiptToken;
    }
    return null;
  }
}
