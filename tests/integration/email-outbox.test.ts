import { describe, expect, it } from 'vitest';

import {
  EmailOutboxProcessor,
  retryDelaySeconds,
  type OutboxEntryContext,
  type OutboxJob,
  type OutboxOutcome,
  type OutboxRepository,
} from '../../lib/email/outbox';
import { deriveReceiptToken, deriveVerificationToken, hashToken } from '../../lib/raffle/tokens';
import type { DeliveryRecord, RaffleMailer } from '../../lib/raffle/service';

const VERIFICATION_SECRET = 'outbox-test-verification-secret';
const RECEIPT_SECRET = 'outbox-test-receipt-secret';
const ACTIVE_TOKEN_ID = '11111111-1111-4111-8111-111111111111';

function receiptTokenFor(tokenId: string) {
  return deriveReceiptToken(
    deriveVerificationToken(tokenId, VERIFICATION_SECRET),
    RECEIPT_SECRET,
  );
}

function context(overrides: Partial<OutboxEntryContext> = {}): OutboxEntryContext {
  return {
    email: 'person@example.com',
    locale: 'en',
    campaignSlug: 'jfca-2026',
    number: BigInt(10_000),
    receiptTokenHash: hashToken(receiptTokenFor(ACTIVE_TOKEN_ID)),
    verificationTokenIds: [ACTIVE_TOKEN_ID],
    activeVerificationTokenId: ACTIVE_TOKEN_ID,
    ...overrides,
  };
}

class MemoryOutboxRepository implements OutboxRepository {
  readonly deliveries: DeliveryRecord[] = [];
  readonly completed: Array<{ id: string } & OutboxOutcome> = [];
  bookkeepingFailure: Error | null = null;

  constructor(
    private readonly jobs: OutboxJob[],
    private readonly entry: OutboxEntryContext | null = context(),
  ) {}

  async claimNextJob() {
    return this.jobs.shift() ?? null;
  }

  async getEntryContext() {
    return this.entry;
  }

  async recordDelivery(delivery: DeliveryRecord) {
    if (this.bookkeepingFailure) throw this.bookkeepingFailure;
    this.deliveries.push(delivery);
  }

  async completeJob(job: OutboxJob, result: OutboxOutcome) {
    this.completed.push({ id: job.id, ...result });
  }
}

class RecordingMailer implements RaffleMailer {
  readonly verification: Array<{ email: string; token: string }> = [];
  readonly receipts: Array<{ email: string; number: bigint; receiptToken: string }> = [];
  failure: Error | null = null;

  async sendVerification(input: { email: string; token: string }) {
    if (this.failure) throw this.failure;
    this.verification.push(input);
    return { id: 'provider-verification' };
  }

  async sendReceipt(input: { email: string; number: bigint; receiptToken: string }) {
    if (this.failure) throw this.failure;
    this.receipts.push(input);
    return { id: 'provider-receipt' };
  }
}

function job(overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    id: 'job-1',
    entryId: 'entry-1',
    kind: 'RECEIPT',
    attemptCount: 1,
    leaseExpiresAt: '2026-07-27T12:05:00.000Z',
    ...overrides,
  };
}

function buildProcessor(repository: OutboxRepository, mailer: RaffleMailer) {
  return new EmailOutboxProcessor({
    repository,
    mailer,
    verificationTokenSecret: VERIFICATION_SECRET,
    receiptTokenSecret: RECEIPT_SECRET,
    onError: () => {},
  });
}

describe('retryDelaySeconds', () => {
  it('doubles per attempt and stops at six hours', () => {
    expect(retryDelaySeconds(1)).toBe(60);
    expect(retryDelaySeconds(2)).toBe(120);
    expect(retryDelaySeconds(3)).toBe(240);
    expect(retryDelaySeconds(40)).toBe(6 * 60 * 60);
  });
});

describe('EmailOutboxProcessor', () => {
  it('rebuilds the permanent receipt link from the stored hash and sends it', async () => {
    const repository = new MemoryOutboxRepository([job()]);
    const mailer = new RecordingMailer();

    const summary = await buildProcessor(repository, mailer).process();

    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0, cancelled: 0, stoppedEarly: false });
    expect(mailer.receipts).toHaveLength(1);
    expect(mailer.receipts[0].receiptToken).toBe(receiptTokenFor(ACTIVE_TOKEN_ID));
    expect(mailer.receipts[0].number).toBe(BigInt(10_000));
    expect(repository.deliveries).toEqual([
      {
        entryId: 'entry-1',
        kind: 'RECEIPT',
        status: 'SENT',
        providerMessageId: 'provider-receipt',
        providerError: null,
      },
    ]);
    expect(repository.completed).toEqual([{ id: 'job-1', status: 'SENT' }]);
  });

  it('resends the same verification link the entry already has', async () => {
    const repository = new MemoryOutboxRepository([job({ kind: 'VERIFICATION' })]);
    const mailer = new RecordingMailer();

    await buildProcessor(repository, mailer).process();

    expect(mailer.verification).toEqual([
      {
        email: 'person@example.com',
        token: deriveVerificationToken(ACTIVE_TOKEN_ID, VERIFICATION_SECRET),
        eventSlug: 'jfca-2026',
        locale: 'en',
      },
    ]);
  });

  it('says plainly when the receipt secret no longer derives the stored link', async () => {
    const repository = new MemoryOutboxRepository([
      job(),
      // A second job proves the batch keeps going after one entry fails.
      job({ id: 'job-2' }),
    ], context({ receiptTokenHash: hashToken('a-hash-from-a-different-secret') }));
    const mailer = new RecordingMailer();

    const summary = await buildProcessor(repository, mailer).process();

    expect(summary).toEqual({ claimed: 2, sent: 0, failed: 2, cancelled: 0, stoppedEarly: false });
    expect(mailer.receipts).toHaveLength(0);
    expect(repository.deliveries[0]).toMatchObject({
      status: 'FAILED',
      providerError: expect.stringContaining('RECEIPT_TOKEN_SECRET'),
    });
  });

  it('does not resend a verification link that is already used or expired', async () => {
    const repository = new MemoryOutboxRepository(
      [job({ kind: 'VERIFICATION' })],
      context({ activeVerificationTokenId: null }),
    );
    const mailer = new RecordingMailer();

    const summary = await buildProcessor(repository, mailer).process();

    // No retry could ever deliver this, so it is retired instead of failing
    // every six hours forever.
    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 0, cancelled: 1, stoppedEarly: false });
    expect(mailer.verification).toHaveLength(0);
    expect(repository.completed[0]).toMatchObject({ status: 'CANCELLED' });
  });

  it('schedules a longer retry the more often a job has failed', async () => {
    const repository = new MemoryOutboxRepository([job({ attemptCount: 4 })]);
    const mailer = new RecordingMailer();
    mailer.failure = new Error('provider unavailable');

    const summary = await buildProcessor(repository, mailer).process();

    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 1, cancelled: 0, stoppedEarly: false });
    expect(repository.completed).toEqual([
      { id: 'job-1', status: 'FAILED', error: 'provider unavailable', retrySeconds: 480 },
    ]);
  });

  it('stops at the batch limit even when more work is queued', async () => {
    const repository = new MemoryOutboxRepository([job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })]);
    const mailer = new RecordingMailer();

    const summary = await buildProcessor(repository, mailer).process(2);

    expect(summary.claimed).toBe(2);
    expect(repository.completed.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('stops before the run budget rather than leasing work it cannot finish', async () => {
    const repository = new MemoryOutboxRepository([job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })]);
    const mailer = new RecordingMailer();
    let clock = 0;
    const processor = new EmailOutboxProcessor({
      repository,
      mailer,
      verificationTokenSecret: VERIFICATION_SECRET,
      receiptTokenSecret: RECEIPT_SECRET,
      // Each claim costs 4 seconds of the 10-second budget.
      now: () => (clock += 4_000) - 4_000,
    });

    const summary = await processor.process(10, 10_000);

    expect(summary.stoppedEarly).toBe(true);
    // Two fit inside the budget; the third was never leased, so it stays
    // claimable by the next run instead of waiting out an expired lease.
    expect(summary.claimed).toBe(2);
    expect(repository.completed.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('leaves the lease to expire when the outcome cannot be recorded', async () => {
    const repository = new MemoryOutboxRepository([job()]);
    repository.bookkeepingFailure = new Error('database unavailable');
    const mailer = new RecordingMailer();

    const summary = await buildProcessor(repository, mailer).process();

    // The message went out, so it is reported as sent and nothing is written
    // that would contradict that.
    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0, cancelled: 0, stoppedEarly: false });
    expect(repository.completed).toHaveLength(0);
  });

  it('refuses to start without both token secrets', () => {
    expect(
      () =>
        new EmailOutboxProcessor({
          repository: new MemoryOutboxRepository([]),
          mailer: new RecordingMailer(),
          verificationTokenSecret: '',
          receiptTokenSecret: RECEIPT_SECRET,
        }),
    ).toThrow('Raffle token secrets are not configured');
  });
});
