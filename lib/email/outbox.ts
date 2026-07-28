import { deriveReceiptToken, deriveVerificationToken, hashToken } from '../raffle/tokens';
import type { DeliveryRecord, RaffleMailer } from '../raffle/service';

export const OUTBOX_BATCH_LIMIT = 20;
/**
 * A cron invocation is killed at the platform's function timeout. Stopping
 * before that leaves each claimed job with a recorded outcome instead of a
 * lease that has to expire before anything retries it.
 */
export const OUTBOX_RUN_BUDGET_MS = 25_000;
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
  completeJob(job: OutboxJob, result: OutboxOutcome): Promise<void>;
}

/**
 * `CANCELLED` is for work that can never succeed, such as a verification retry
 * whose link expired before the worker reached it. Retrying those forever
 * would bury the failures an operator can still act on.
 */
export type OutboxOutcome =
  | { status: 'SENT' }
  | { status: 'FAILED'; error: string; retrySeconds: number }
  | { status: 'CANCELLED'; error: string };

/** Thrown by a send when no retry could ever make it succeed. */
export class OutboxJobUnsatisfiable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxJobUnsatisfiable';
  }
}

export interface OutboxRunSummary {
  claimed: number;
  sent: number;
  failed: number;
  cancelled: number;
  /** True when the budget ended the run before the batch limit was reached. */
  stoppedEarly: boolean;
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
      now?: () => number;
    },
  ) {
    if (!dependencies.verificationTokenSecret || !dependencies.receiptTokenSecret) {
      throw new Error('Raffle token secrets are not configured');
    }
  }

  async process(
    limit = OUTBOX_BATCH_LIMIT,
    budgetMs = OUTBOX_RUN_BUDGET_MS,
  ): Promise<OutboxRunSummary> {
    const clock = this.dependencies.now ?? (() => Date.now());
    const deadline = clock() + budgetMs;
    const summary: OutboxRunSummary = {
      claimed: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
      stoppedEarly: false,
    };

    for (let processed = 0; processed < limit; processed += 1) {
      // Checked before claiming, so the run never leases a job it has no time
      // left to deliver.
      if (clock() >= deadline) {
        summary.stoppedEarly = true;
        break;
      }

      const job = await this.dependencies.repository.claimNextJob();
      if (!job) break;
      summary.claimed += 1;

      const outcome = await this.deliver(job);
      if (outcome.status === 'SENT') summary.sent += 1;
      else if (outcome.status === 'CANCELLED') summary.cancelled += 1;
      else summary.failed += 1;
    }

    return summary;
  }

  private async deliver(job: OutboxJob): Promise<OutboxOutcome> {
    let providerMessageId: string | null = null;
    let outcome: OutboxOutcome = { status: 'SENT' };

    try {
      const context = await this.dependencies.repository.getEntryContext(job.entryId);
      if (!context) throw new OutboxJobUnsatisfiable('Outbox entry no longer exists');

      const result =
        job.kind === 'VERIFICATION'
          ? await this.sendVerification(context)
          : await this.sendReceipt(context);
      providerMessageId = result.id ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'mail provider failed';
      outcome =
        error instanceof OutboxJobUnsatisfiable
          ? { status: 'CANCELLED', error: message }
          : { status: 'FAILED', error: message, retrySeconds: retryDelaySeconds(job.attemptCount) };
    }

    try {
      await this.dependencies.repository.recordDelivery({
        entryId: job.entryId,
        kind: job.kind,
        status: outcome.status === 'SENT' ? 'SENT' : 'FAILED',
        providerMessageId,
        providerError: outcome.status === 'SENT' ? null : outcome.error,
      });
      await this.dependencies.repository.completeJob(job, outcome);
    } catch (error) {
      // The message may already be out. Leave the lease to expire rather than
      // recording an outcome we could not persist.
      this.dependencies.onError?.(error);
    }

    return outcome;
  }

  private async sendVerification(context: OutboxEntryContext) {
    const tokenId = context.activeVerificationTokenId;
    if (!tokenId) {
      // The link expired or was already used, so no retry can ever deliver it.
      throw new OutboxJobUnsatisfiable('No active verification link remains for this entry');
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
      throw new OutboxJobUnsatisfiable('Receipt requested for an entry without an issued number');
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
