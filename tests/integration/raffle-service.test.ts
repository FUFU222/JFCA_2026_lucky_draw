import { describe, expect, it } from 'vitest';

import type { Campaign, RaffleEntry } from '../../lib/db/types';
import {
  MAX_VERIFICATION_SENDS,
  RESEND_COOLDOWN_SECONDS,
  RaffleLinkError,
  RaffleService,
  type ConfirmedVerification,
  type DeliveryRecord,
  type PendingEntryInput,
  type RaffleMailer,
  type RaffleRepository,
  type ReceiptJob,
  type VerificationToken,
} from '../../lib/raffle/service';

const now = new Date('2026-07-27T12:00:00.000Z');

function scheduledCampaign(): Campaign {
  return {
    id: 'campaign-1',
    slug: 'jfca-2026',
    title: 'JFCA 2026',
    status: 'SCHEDULED',
    opens_at: '2026-07-27T11:00:00.000Z',
    draw_starts_at: '2026-07-28T12:00:00.000Z',
    next_number: 10000,
    test_next_number: 900000001,
    terms_version: '2026-07',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

/**
 * Stands in for the database. The send gate and the outbox lease are modelled
 * as the single atomic steps the SQL functions actually provide, so a test
 * cannot pass against behaviour the schema does not have.
 */
class MemoryRepository implements RaffleRepository {
  readonly campaign = scheduledCampaign();
  readonly entries: RaffleEntry[] = [];
  readonly tokens: VerificationToken[] = [];
  readonly deliveries: DeliveryRecord[] = [];
  readonly completedJobs: Array<{ jobId: string; lease: string; sent: boolean; error?: string }> = [];
  readonly armedJobs: Array<{ entryId: string; kind: string; error: string }> = [];
  readonly settledJobs: Array<{ entryId: string; kind: string }> = [];
  receiptJobAvailable = true;
  confirmFailure: Error | null = null;
  private assignedNumber: bigint | null = null;

  constructor(private readonly clock: () => Date = () => now) {}

  async getCampaignBySlug(slug: string) {
    return slug === this.campaign.slug ? this.campaign : null;
  }

  async findEntryByEmail(_campaignId: string, email: string) {
    return this.entries.find((entry) => entry.email === email) ?? null;
  }

  async createPendingEntry(input: PendingEntryInput) {
    const entry: RaffleEntry = {
      ...input,
      id: `entry-${this.entries.length + 1}`,
      state: 'PENDING',
      number: null,
      verified_at: null,
      receipt_token_hash: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    this.entries.push(entry);
    return entry;
  }

  async updatePendingEntry(entryId: string, changes: Partial<RaffleEntry>) {
    const entry = this.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new Error('missing entry');
    // Mirrors the `state = 'PENDING'` guard on the real update.
    if (entry.state !== 'PENDING') return null;
    Object.assign(entry, changes);
    return entry;
  }

  async getLatestVerificationToken(entryId: string) {
    return this.tokens.filter((token) => token.entryId === entryId).at(-1) ?? null;
  }

  async createVerificationToken(input: VerificationToken) {
    this.tokens.push(input);
    return input;
  }

  async claimVerificationSend(tokenId: string, maxSends: number, cooldownSeconds: number) {
    const token = this.tokens.find((candidate) => candidate.id === tokenId);
    if (!token) return false;
    const at = this.clock().getTime();
    const lastSentAt = token.lastSentAt ? new Date(token.lastSentAt).getTime() : null;
    if (token.consumedAt !== null) return false;
    if (new Date(token.expiresAt).getTime() <= at) return false;
    if (token.sendCount >= maxSends) return false;
    if (lastSentAt !== null && at - lastSentAt < cooldownSeconds * 1000) return false;
    token.sendCount += 1;
    token.lastSentAt = new Date(at).toISOString();
    return true;
  }

  async recordDelivery(input: DeliveryRecord) {
    this.deliveries.push(input);
  }

  async confirmVerification(
    tokenHash: string,
    _receiptTokenHash: string,
    eventSlug: string,
  ): Promise<ConfirmedVerification | null> {
    if (eventSlug !== this.campaign.slug) {
      throw new RaffleLinkError('Verification link belongs to another event');
    }
    if (this.confirmFailure) throw this.confirmFailure;
    const token = this.tokens.find((candidate) => candidate.tokenHash === tokenHash);
    if (!token) throw new RaffleLinkError('Verification token was not found');
    const entry = this.entries.find((candidate) => candidate.id === token.entryId);
    if (!entry) throw new RaffleLinkError('Verification entry was not found');

    // The RPC issues one number per entry and returns the same one afterwards.
    if (this.assignedNumber === null) {
      this.assignedNumber = BigInt(this.campaign.next_number);
      entry.state = 'VERIFIED';
      entry.number = Number(this.assignedNumber);
      token.consumedAt = this.clock().toISOString();
    }

    return {
      entryId: entry.id,
      email: entry.email,
      locale: entry.locale,
      campaignSlug: this.campaign.slug,
      number: this.assignedNumber,
    };
  }

  async claimReceiptJob(entryId: string): Promise<ReceiptJob | null> {
    // A lease is granted once; the second caller sees nothing to send.
    if (!this.receiptJobAvailable) return null;
    this.receiptJobAvailable = false;
    const entry = this.entries.find((candidate) => candidate.id === entryId);
    if (!entry || entry.number === null) return null;
    return {
      id: 'receipt-job-1',
      entryId,
      email: entry.email,
      number: BigInt(entry.number),
      leaseExpiresAt: new Date(this.clock().getTime() + 5 * 60 * 1000).toISOString(),
    };
  }

  async completeReceiptJob(job: ReceiptJob, result: { sent: boolean; error?: string }) {
    this.completedJobs.push({ jobId: job.id, lease: job.leaseExpiresAt, ...result });
  }

  async armOutboxJob(entryId: string, kind: 'VERIFICATION' | 'RECEIPT', error: string) {
    this.armedJobs.push({ entryId, kind, error });
  }

  async settleOutboxJob(entryId: string, kind: 'VERIFICATION' | 'RECEIPT') {
    this.settledJobs.push({ entryId, kind });
  }
}

class FakeMailer implements RaffleMailer {
  readonly verification: Array<{ eventSlug: string; email: string; token: string }> = [];
  readonly receipts: Array<{ email: string; number: bigint; receiptToken: string }> = [];
  receiptFailure: Error | null = null;

  async sendVerification(input: { eventSlug: string; email: string; token: string }) {
    this.verification.push(input);
    return { id: 'verification-1' };
  }

  async sendReceipt(input: { email: string; number: bigint; receiptToken: string }) {
    if (this.receiptFailure) throw this.receiptFailure;
    this.receipts.push(input);
    return { id: 'receipt-1' };
  }
}

function buildService(overrides: {
  repository?: MemoryRepository;
  mailer?: FakeMailer;
  turnstile?: { verify: () => Promise<boolean> };
  rateLimiter?: { consume: () => Promise<boolean> };
  clock?: () => Date;
  verifyOperatorSession?: () => Promise<boolean>;
} = {}) {
  const clock = overrides.clock ?? (() => now);
  const repository = overrides.repository ?? new MemoryRepository(clock);
  const mailer = overrides.mailer ?? new FakeMailer();
  const service = new RaffleService({
    repository,
    mailer,
    turnstile: overrides.turnstile ?? { verify: async () => true },
    rateLimiter: overrides.rateLimiter ?? { consume: async () => true },
    now: clock,
    verificationTokenSecret: 'test-verification-secret',
    receiptTokenSecret: 'test-receipt-secret',
    verifyOperatorSession: overrides.verifyOperatorSession,
  });
  return { service, repository, mailer };
}

const validRequest = {
  eventSlug: 'jfca-2026',
  email: 'person@example.com',
  locale: 'en' as const,
  termsConsent: true as const,
  turnstileToken: 'turnstile-token',
  ipAddress: '203.0.113.1',
};

describe('RaffleService registration', () => {
  it('creates one pending entry, a 24-hour token, and one verification delivery on first submission', async () => {
    const { service, repository, mailer } = buildService();

    const result = await service.requestVerification({
      ...validRequest,
      email: '  PERSON@EXAMPLE.COM ',
    });

    expect(result).toEqual({ accepted: true });
    expect(repository.entries).toHaveLength(1);
    expect(repository.entries[0]).toMatchObject({ email: 'person@example.com', state: 'PENDING' });
    expect(repository.tokens).toHaveLength(1);
    expect(repository.tokens[0]).toMatchObject({ sendCount: 1 });
    expect(new Date(repository.tokens[0].expiresAt).getTime() - now.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
    expect(mailer.verification).toHaveLength(1);
    expect(mailer.verification[0].eventSlug).toBe('jfca-2026');
    expect(repository.deliveries).toMatchObject([
      { entryId: 'entry-1', kind: 'VERIFICATION', status: 'SENT', providerMessageId: 'verification-1' },
    ]);
  });

  it('refuses input that fails validation before causing any side effect', async () => {
    const cases = [
      { ...validRequest, termsConsent: false },
      { ...validRequest, email: 'not-an-address' },
      { ...validRequest, locale: 'fr' },
      { ...validRequest, turnstileToken: '' },
      { ...validRequest, dateOfBirth: '31-12-1990' },
    ];

    for (const input of cases) {
      const { service, repository, mailer } = buildService();
      await expect(service.requestVerification(input)).resolves.toEqual({
        accepted: false,
        reason: 'invalid',
      });
      expect(repository.entries).toHaveLength(0);
      expect(mailer.verification).toHaveLength(0);
    }
  });

  it('refuses a failed Turnstile challenge and a closed campaign without writing anything', async () => {
    const failedCaptcha = buildService({ turnstile: { verify: async () => false } });
    await expect(failedCaptcha.service.requestVerification(validRequest)).resolves.toEqual({
      accepted: false,
      reason: 'turnstile',
    });
    expect(failedCaptcha.repository.entries).toHaveLength(0);

    const closed = buildService();
    closed.repository.campaign.status = 'PAUSED';
    await expect(closed.service.requestVerification(validRequest)).resolves.toEqual({
      accepted: false,
      reason: 'closed',
    });
    expect(closed.repository.entries).toHaveLength(0);
  });

  it('does not spend a rate-limit allowance when registration is not open', async () => {
    const consumed: unknown[] = [];
    const { service, repository } = buildService({
      rateLimiter: {
        consume: async () => {
          consumed.push(true);
          return true;
        },
      },
    });
    repository.campaign.status = 'CLOSED';

    await service.requestVerification(validRequest);

    expect(consumed).toHaveLength(0);
  });

  it('refuses a rate-limited submission', async () => {
    const { service, repository } = buildService({ rateLimiter: { consume: async () => false } });

    await expect(service.requestVerification(validRequest)).resolves.toEqual({
      accepted: false,
      reason: 'rate_limited',
    });
    expect(repository.entries).toHaveLength(0);
  });

  it('keeps a verified entry unchanged and issues no further token', async () => {
    const { service, repository, mailer } = buildService();
    await service.requestVerification({ ...validRequest, firstName: 'Ada' });
    repository.entries[0].state = 'VERIFIED';
    repository.entries[0].number = 10_000;

    const result = await service.requestVerification({ ...validRequest, firstName: 'Someone' });

    expect(result).toEqual({ accepted: true });
    expect(repository.entries).toHaveLength(1);
    expect(repository.entries[0].first_name).toBe('Ada');
    expect(repository.tokens).toHaveLength(1);
    expect(mailer.verification).toHaveLength(1);
  });

  it('never erases profile data a later blank submission omits', async () => {
    let clock = now;
    const { service, repository } = buildService({ clock: () => clock });
    await service.requestVerification({
      ...validRequest,
      firstName: 'Ada',
      country: 'Canada',
      region: 'Ontario',
    });

    clock = new Date(now.getTime() + 5 * 60 * 1000);
    await service.requestVerification({ ...validRequest, firstName: '', country: 'Japan' });

    expect(repository.entries[0]).toMatchObject({
      first_name: 'Ada',
      country: 'Japan',
      region: 'Ontario',
    });
  });
});

describe('RaffleService resend', () => {
  it('reuses an active token and enforces the cooldown and the send ceiling', async () => {
    let clock = now;
    const { service, repository, mailer } = buildService({ clock: () => clock });
    const resendRequest = {
      eventSlug: validRequest.eventSlug,
      email: validRequest.email,
      turnstileToken: validRequest.turnstileToken,
      ipAddress: validRequest.ipAddress,
    };

    await service.requestVerification(validRequest);
    const originalToken = mailer.verification[0].token;

    // Still inside the cooldown, so nothing is sent.
    await service.resendVerification(resendRequest);
    expect(mailer.verification).toHaveLength(1);

    for (let sent = 0; sent < 3; sent += 1) {
      clock = new Date(clock.getTime() + RESEND_COOLDOWN_SECONDS * 1000);
      await service.resendVerification(resendRequest);
    }

    expect(mailer.verification.map((delivery) => delivery.token)).toEqual(
      Array.from({ length: MAX_VERIFICATION_SENDS }, () => originalToken),
    );
    expect(repository.tokens).toHaveLength(1);
    expect(repository.tokens[0].sendCount).toBe(MAX_VERIFICATION_SENDS);
  });

  it('accepts an unknown or verified address without sending or disclosing anything', async () => {
    const unknown = buildService();
    await expect(
      unknown.service.resendVerification({
        eventSlug: 'jfca-2026',
        email: 'nobody@example.com',
        turnstileToken: 'turnstile-token',
      }),
    ).resolves.toEqual({ accepted: true });
    expect(unknown.mailer.verification).toHaveLength(0);

    const verified = buildService();
    await verified.service.requestVerification(validRequest);
    verified.repository.entries[0].state = 'VERIFIED';
    await expect(
      verified.service.resendVerification({
        eventSlug: 'jfca-2026',
        email: validRequest.email,
        turnstileToken: 'turnstile-token',
      }),
    ).resolves.toEqual({ accepted: true });
    expect(verified.mailer.verification).toHaveLength(1);
  });

  it('issues a replacement token only after the previous one expired', async () => {
    let clock = now;
    const { service, repository, mailer } = buildService({ clock: () => clock });
    // Registration must still be open once the first token has expired.
    repository.campaign.draw_starts_at = '2026-07-30T12:00:00.000Z';
    await service.requestVerification(validRequest);

    clock = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    await service.requestVerification(validRequest);

    expect(repository.tokens).toHaveLength(2);
    expect(mailer.verification[1].token).not.toBe(mailer.verification[0].token);
  });
});

describe('RaffleService test mode', () => {
  it('ignores an isTest claim when the operator session cannot be verified', async () => {
    const { service, repository } = buildService({ verifyOperatorSession: async () => false });
    repository.campaign.status = 'CLOSED';

    await expect(
      service.requestVerification({ ...validRequest, isTest: true }),
    ).resolves.toEqual({ accepted: false, reason: 'closed' });
    expect(repository.entries).toHaveLength(0);
  });

  it('honors isTest only once a real operator session is verified, bypassing the schedule and the rate limit', async () => {
    const consumed: unknown[] = [];
    const { service, repository, mailer } = buildService({
      verifyOperatorSession: async () => true,
      rateLimiter: {
        consume: async () => {
          consumed.push(true);
          return false; // Would refuse a real request; must not even be asked for a test one.
        },
      },
    });
    repository.campaign.status = 'CLOSED';

    const result = await service.requestVerification({ ...validRequest, isTest: true });

    expect(result).toEqual({ accepted: true });
    expect(consumed).toHaveLength(0);
    expect(repository.entries).toMatchObject([{ is_test: true, state: 'PENDING' }]);
    expect(mailer.verification).toHaveLength(1);
  });

  it('does not mark an entry as test when isTest is absent, even with a verified operator session', async () => {
    const { service, repository } = buildService({ verifyOperatorSession: async () => true });

    await service.requestVerification(validRequest);

    expect(repository.entries).toMatchObject([{ is_test: false }]);
  });

  it('applies the same verified-session gate to a resend', async () => {
    const { service, repository } = buildService({ verifyOperatorSession: async () => false });
    repository.campaign.status = 'CLOSED';

    await expect(
      service.resendVerification({
        eventSlug: validRequest.eventSlug,
        email: validRequest.email,
        turnstileToken: validRequest.turnstileToken,
        isTest: true,
      }),
    ).resolves.toEqual({ accepted: false, reason: 'closed' });
  });
});

describe('RaffleService confirmation', () => {
  it('returns the same permanent number when confirmation is repeated concurrently', async () => {
    const { service, mailer } = buildService();
    await service.requestVerification(validRequest);
    const token = mailer.verification[0].token;

    const [first, repeated] = await Promise.all([
      service.confirmVerification({ eventSlug: 'jfca-2026', token }),
      service.confirmVerification({ eventSlug: 'jfca-2026', token }),
    ]);

    expect([first?.number, repeated?.number]).toEqual([BigInt(10_000), BigInt(10_000)]);
    expect(first?.receiptToken).toBe(repeated?.receiptToken);
  });

  it('sends exactly one receipt even when confirmation is repeated', async () => {
    const { service, mailer, repository } = buildService();
    await service.requestVerification(validRequest);
    const token = mailer.verification[0].token;

    await service.confirmVerification({ eventSlug: 'jfca-2026', token });
    await service.confirmVerification({ eventSlug: 'jfca-2026', token });

    expect(mailer.receipts).toHaveLength(1);
    expect(mailer.receipts[0].number).toBe(BigInt(10_000));
    expect(repository.completedJobs).toMatchObject([{ jobId: 'receipt-job-1', sent: true }]);
  });

  it('keeps the number valid and the job retryable when the receipt cannot be sent', async () => {
    const { service, mailer, repository } = buildService();
    await service.requestVerification(validRequest);
    mailer.receiptFailure = new Error('resend unavailable');

    const result = await service.confirmVerification({
      eventSlug: 'jfca-2026',
      token: mailer.verification[0].token,
    });

    expect(result?.number).toBe(BigInt(10_000));
    expect(repository.entries[0]).toMatchObject({ state: 'VERIFIED', number: 10_000 });
    expect(repository.deliveries).toContainEqual({
      entryId: 'entry-1',
      kind: 'RECEIPT',
      status: 'FAILED',
      providerMessageId: null,
      providerError: 'resend unavailable',
    });
    expect(repository.completedJobs).toMatchObject([
      { jobId: 'receipt-job-1', sent: false, error: 'resend unavailable' },
    ]);
  });

  it('reports an unusable link as null and a server fault as an error', async () => {
    const unusable = buildService();
    await expect(
      unusable.service.confirmVerification({
        eventSlug: 'jfca-2026',
        token: 'a'.repeat(43),
      }),
    ).resolves.toBeNull();

    const faulty = buildService();
    await faulty.service.requestVerification(validRequest);
    faulty.repository.confirmFailure = new Error('database unavailable');
    await expect(
      faulty.service.confirmVerification({
        eventSlug: 'jfca-2026',
        token: faulty.mailer.verification[0].token,
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('refuses a malformed token and a token confirmed through another event', async () => {
    const { service, mailer } = buildService();
    await service.requestVerification(validRequest);

    await expect(
      service.confirmVerification({ eventSlug: 'jfca-2026', token: 'short' }),
    ).resolves.toBeNull();
    await expect(
      service.confirmVerification({ eventSlug: 'other-event', token: mailer.verification[0].token }),
    ).resolves.toBeNull();
  });
});

describe('RaffleService configuration', () => {
  it('refuses to start without both token secrets', () => {
    const dependencies = {
      repository: new MemoryRepository(),
      mailer: new FakeMailer(),
      turnstile: { verify: async () => true },
      rateLimiter: { consume: async () => true },
    };

    expect(
      () =>
        new RaffleService({
          ...dependencies,
          verificationTokenSecret: '',
          receiptTokenSecret: 'receipt',
        }),
    ).toThrow('Raffle token secrets are not configured');
    expect(
      () =>
        new RaffleService({
          ...dependencies,
          verificationTokenSecret: 'verification',
          receiptTokenSecret: '',
        }),
    ).toThrow('Raffle token secrets are not configured');
  });
});
