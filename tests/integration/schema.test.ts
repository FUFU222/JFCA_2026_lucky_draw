import { readFile } from 'node:fs/promises';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  hasSupabaseCredentials,
  supabaseServiceRoleKey,
  supabaseUrl,
} from '../supabase-env';

const describeWithSupabase = hasSupabaseCredentials ? describe : describe.skip;

type EntryInput = {
  campaignId: string;
  email: string;
  number?: number;
  isTest?: boolean;
};

let supabase: SupabaseClient;
const testCampaignIds: string[] = [];
const testRateLimitKeys: string[] = [];

function uniqueSlug() {
  return `schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createCampaign(overrides: Record<string, unknown> = {}) {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      slug: uniqueSlug(),
      title: 'Schema test',
      status: 'DRAFT',
      terms_version: 'test-v1',
      ...overrides,
    })
    .select('id, slug, next_number, test_next_number')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Campaign was not created');
  }

  testCampaignIds.push(data.id);
  return data as {
    id: string;
    slug: string;
    next_number: number;
    test_next_number: number;
  };
}

async function createEntry({ campaignId, email, number, isTest }: EntryInput) {
  const isVerified = number !== undefined;
  const { data, error } = await supabase
    .from('raffle_entries')
    .insert({
      campaign_id: campaignId,
      email,
      locale: 'en',
      terms_version: 'test-v1',
      terms_consented_at: new Date().toISOString(),
      state: isVerified ? 'VERIFIED' : 'PENDING',
      number,
      verified_at: isVerified ? new Date().toISOString() : null,
      is_test: isTest ?? false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`${error.code}: ${error.message}`);
  }

  return data;
}

async function createVerificationToken(entryId: string, expiresAt: string) {
  const tokenHash = `verification-${uniqueSlug()}`;
  const { error } = await supabase.from('verification_tokens').insert({
    entry_id: entryId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`${error.code}: ${error.message}`);
  }

  return tokenHash;
}

async function createVerificationTokenRow(entryId: string, expiresAt: string) {
  const { data, error } = await supabase
    .from('verification_tokens')
    .insert({
      entry_id: entryId,
      token_hash: `verification-${uniqueSlug()}`,
      expires_at: expiresAt,
    })
    .select('id, token_hash')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Verification token was not created');
  }

  return data as { id: string; token_hash: string };
}

async function rpcError(name: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(name, args);
  return error;
}

async function callRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    throw new Error(`${error.code}: ${error.message}`);
  }

  return data as T;
}

describeWithSupabase('lucky draw schema', () => {
  beforeAll(() => {
    supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  });

  afterEach(async () => {
    const campaignIds = testCampaignIds.splice(0, testCampaignIds.length);
    const rateLimitKeys = testRateLimitKeys.splice(0, testRateLimitKeys.length);
    const cleanupErrors: Error[] = [];

    if (campaignIds.length > 0) {
      const { error: entriesError } = await supabase
        .from('raffle_entries')
        .delete()
        .in('campaign_id', campaignIds);

      if (entriesError) {
        cleanupErrors.push(new Error(`${entriesError.code}: ${entriesError.message}`));
      }

      const { error: campaignsError } = await supabase.from('campaigns').delete().in('id', campaignIds);

      if (campaignsError) {
        cleanupErrors.push(new Error(`${campaignsError.code}: ${campaignsError.message}`));
      }
    }

    if (rateLimitKeys.length > 0) {
      const { error: rateLimitError } = await supabase
        .from('rate_limit_buckets')
        .delete()
        .in('bucket_key', rateLimitKeys);

      if (rateLimitError) {
        cleanupErrors.push(new Error(`${rateLimitError.code}: ${rateLimitError.message}`));
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Schema integration test cleanup failed');
    }
  });

  it('seeds the initial jfca-2026 campaign', async () => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('slug, title')
      .eq('slug', 'jfca-2026')
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ slug: 'jfca-2026', title: 'Japan Festival Canada 2026' });
  });

  it('never opens the campaign it seeds', async () => {
    // Asserted against the seed itself rather than the row, because an operator
    // legitimately changes the row's status and dates. The property that has to
    // hold is that the campaign is not born open.
    const seed = await readFile('supabase/seed.sql', 'utf8');

    expect(seed).toContain("'DRAFT'");
    expect(seed).not.toMatch(/'SCHEDULED'|'CLOSED'/);
    // Both timestamps are inserted as nulls, so a fresh deployment cannot start
    // accepting entries before an operator sets a schedule.
    expect(seed.match(/\bnull\b/g) ?? []).toHaveLength(2);
    expect(seed).toContain('on conflict (slug) do nothing');
  });

  it('rejects a duplicate verified number within one campaign', async () => {
    const campaign = await createCampaign();

    await expect(createEntry({ campaignId: campaign.id, email: 'first@example.com', number: 10_000 }))
      .resolves.toBeDefined();
    await expect(createEntry({ campaignId: campaign.id, email: 'second@example.com', number: 10_000 }))
      .rejects.toThrow();
  });

  it('rejects a duplicate normalized email within one campaign', async () => {
    const campaign = await createCampaign();

    await expect(createEntry({ campaignId: campaign.id, email: 'user@example.com' }))
      .resolves.toBeDefined();
    await expect(createEntry({ campaignId: campaign.id, email: 'USER@example.com' }))
      .rejects.toThrow();
  });

  it('rejects an email with leading or trailing whitespace', async () => {
    const campaign = await createCampaign();

    await expect(createEntry({ campaignId: campaign.id, email: 'user@example.com' }))
      .resolves.toBeDefined();
    await expect(createEntry({ campaignId: campaign.id, email: 'user@example.com ' }))
      .rejects.toThrow();
    await expect(createEntry({ campaignId: campaign.id, email: ' user@example.com' }))
      .rejects.toThrow();
  });

  it('atomically allows only the configured rate-limit threshold', async () => {
    const key = `ip:${uniqueSlug()}`;
    testRateLimitKeys.push(key);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        callRpc<boolean>('consume_raffle_rate_limit', {
          p_key: key,
          p_limit: 2,
          p_window_seconds: 60,
        }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(2);
    expect(results.filter((result) => !result)).toHaveLength(2);
  });

  it('purges rate-limit buckets past their retention horizon during consumption', async () => {
    const staleKey = `email:${uniqueSlug()}`;
    const activeKey = `ip:${uniqueSlug()}`;
    testRateLimitKeys.push(staleKey, activeKey);
    const { error: staleBucketError } = await supabase.from('rate_limit_buckets').insert({
      bucket_key: staleKey,
      window_started_at: new Date(Date.now() - 49 * 60 * 60 * 1_000).toISOString(),
      window_seconds: 60,
      request_count: 1,
    });

    if (staleBucketError) {
      throw new Error(`${staleBucketError.code}: ${staleBucketError.message}`);
    }

    await expect(
      callRpc<boolean>('consume_raffle_rate_limit', {
        p_key: activeKey,
        p_limit: 1,
        p_window_seconds: 60,
      }),
    ).resolves.toBe(true);

    const { data: staleBucket, error: staleBucketQueryError } = await supabase
      .from('rate_limit_buckets')
      .select('bucket_key')
      .eq('bucket_key', staleKey)
      .maybeSingle();

    expect(staleBucketQueryError).toBeNull();
    expect(staleBucket).toBeNull();
  });

  it('issues one number and one receipt job when verification is repeated', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'verify@example.com' });
    const tokenHash = await createVerificationToken(
      entry.id,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const receiptTokenHash = `receipt-${uniqueSlug()}`;

    const firstNumber = await callRpc<number>('confirm_raffle_verification', {
      p_token_hash: tokenHash,
      p_receipt_token_hash: receiptTokenHash,
      p_event_slug: campaign.slug,
    });
    const repeatedNumber = await callRpc<number>('confirm_raffle_verification', {
      p_token_hash: tokenHash,
      p_receipt_token_hash: receiptTokenHash,
      p_event_slug: campaign.slug,
    });

    expect(firstNumber).toBe(10_000);
    expect(repeatedNumber).toBe(firstNumber);

    const { data: jobs, error } = await supabase
      .from('email_outbox')
      .select('id, kind')
      .eq('entry_id', entry.id)
      .eq('kind', 'RECEIPT');

    expect(error).toBeNull();
    expect(jobs).toHaveLength(1);
  });

  it('issues a test entry a number from the separate test counter, leaving next_number untouched', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({
      campaignId: campaign.id,
      email: 'test-mode@example.com',
      isTest: true,
    });
    const tokenHash = await createVerificationToken(
      entry.id,
      new Date(Date.now() + 60_000).toISOString(),
    );

    const assigned = await callRpc<number>('confirm_raffle_verification', {
      p_token_hash: tokenHash,
      p_receipt_token_hash: `receipt-${uniqueSlug()}`,
      p_event_slug: campaign.slug,
    });

    expect(assigned).toBe(900_000_001);

    const { data: after, error } = await supabase
      .from('campaigns')
      .select('next_number, test_next_number')
      .eq('id', campaign.id)
      .single();

    expect(error).toBeNull();
    expect(after?.next_number).toBe(campaign.next_number);
    expect(after?.test_next_number).toBe(900_000_002);
  });

  it('lets a test entry confirm after the campaign is closed, unlike a real one', async () => {
    const campaign = await createCampaign({ status: 'CLOSED' });

    const realEntry = await createEntry({ campaignId: campaign.id, email: 'closed-real@example.com' });
    const realToken = await createVerificationToken(
      realEntry.id,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const realError = await rpcError('confirm_raffle_verification', {
      p_token_hash: realToken,
      p_receipt_token_hash: `receipt-${uniqueSlug()}`,
      p_event_slug: campaign.slug,
    });
    expect(realError?.code).toBe('RD001');

    const testEntry = await createEntry({
      campaignId: campaign.id,
      email: 'closed-test@example.com',
      isTest: true,
    });
    const testToken = await createVerificationToken(
      testEntry.id,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const assigned = await callRpc<number>('confirm_raffle_verification', {
      p_token_hash: testToken,
      p_receipt_token_hash: `receipt-${uniqueSlug()}`,
      p_event_slug: campaign.slug,
    });

    expect(assigned).toBe(900_000_001);
  });

  it('increments a verification send only once under concurrency', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'send@example.com' });
    const token = await createVerificationTokenRow(
      entry.id,
      new Date(Date.now() + 60_000).toISOString(),
    );

    const claims = await Promise.all(
      Array.from({ length: 4 }, () =>
        callRpc<boolean>('claim_verification_send', {
          p_token_id: token.id,
          p_max_sends: 3,
          p_cooldown_seconds: 120,
        }),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);

    const { data: after, error } = await supabase
      .from('verification_tokens')
      .select('send_count, last_sent_at')
      .eq('id', token.id)
      .single();

    expect(error).toBeNull();
    expect(after?.send_count).toBe(1);
    expect(after?.last_sent_at).not.toBeNull();
  });

  it('refuses a verification send once the cooldown, ceiling, or lifetime is exhausted', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'cooldown@example.com' });
    const token = await createVerificationTokenRow(
      entry.id,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const claim = (overrides: Record<string, unknown> = {}) =>
      callRpc<boolean>('claim_verification_send', {
        p_token_id: token.id,
        p_max_sends: 3,
        p_cooldown_seconds: 120,
        ...overrides,
      });

    await expect(claim()).resolves.toBe(true);
    // The cooldown has not elapsed, so the second attempt is refused.
    await expect(claim()).resolves.toBe(false);
    // With no cooldown the ceiling is the only remaining limit.
    await expect(claim({ p_cooldown_seconds: 0 })).resolves.toBe(true);
    await expect(claim({ p_cooldown_seconds: 0 })).resolves.toBe(true);
    await expect(claim({ p_cooldown_seconds: 0 })).resolves.toBe(false);

    const expired = await createVerificationTokenRow(
      entry.id,
      new Date(Date.now() - 1_000).toISOString(),
    );

    await expect(
      callRpc<boolean>('claim_verification_send', {
        p_token_id: expired.id,
        p_max_sends: 3,
        p_cooldown_seconds: 0,
      }),
    ).resolves.toBe(false);
  });

  it('leases one entry receipt job to only one concurrent sender', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'receipt@example.com' });
    const { error: jobError } = await supabase
      .from('email_outbox')
      .insert({ entry_id: entry.id, kind: 'RECEIPT' });

    if (jobError) {
      throw new Error(`${jobError.code}: ${jobError.message}`);
    }

    const claims = await Promise.all([
      callRpc<unknown[]>('claim_email_outbox_job_for_entry', {
        p_entry_id: entry.id,
        p_kind: 'RECEIPT',
      }),
      callRpc<unknown[]>('claim_email_outbox_job_for_entry', {
        p_entry_id: entry.id,
        p_kind: 'RECEIPT',
      }),
    ]);

    expect(claims.flat()).toHaveLength(1);
  });

  it('reports an unusable verification link with a distinct error code', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'code@example.com' });
    const tokenHash = await createVerificationToken(
      entry.id,
      new Date(Date.now() - 60_000).toISOString(),
    );

    const expiredError = await rpcError('confirm_raffle_verification', {
      p_token_hash: tokenHash,
      p_receipt_token_hash: `receipt-${uniqueSlug()}`,
      p_event_slug: campaign.slug,
    });
    const missingError = await rpcError('confirm_raffle_verification', {
      p_token_hash: `absent-${uniqueSlug()}`,
      p_receipt_token_hash: `receipt-${uniqueSlug()}`,
      p_event_slug: campaign.slug,
    });

    expect(expiredError?.code).toBe('RD001');
    expect(missingError?.code).toBe('RD001');
  });

  it('reports a receipt-secret mismatch separately from an unusable link', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'rotated@example.com' });
    const tokenHash = await createVerificationToken(
      entry.id,
      new Date(Date.now() + 60_000).toISOString(),
    );

    await callRpc<number>('confirm_raffle_verification', {
      p_token_hash: tokenHash,
      p_receipt_token_hash: `receipt-${uniqueSlug()}`,
      p_event_slug: campaign.slug,
    });
    // The link that issued the number is now consumed, so presenting it with a
    // different derived receipt reads as an unusable link, not a rotation.
    const staleError = await rpcError('confirm_raffle_verification', {
      p_token_hash: tokenHash,
      p_receipt_token_hash: `receipt-${uniqueSlug()}`,
      p_event_slug: campaign.slug,
    });

    expect(staleError?.code).toBe('RD001');

    // A live, unconsumed link whose derived receipt differs from the stored one
    // can only mean the receipt secret changed.
    const liveToken = await createVerificationToken(
      entry.id,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const rotatedError = await rpcError('confirm_raffle_verification', {
      p_token_hash: liveToken,
      p_receipt_token_hash: `receipt-${uniqueSlug()}`,
      p_event_slug: campaign.slug,
    });

    expect(rotatedError?.code).toBe('RD002');
  });

  it('rejects an expired verification token without issuing a number', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'expired@example.com' });
    const tokenHash = await createVerificationToken(
      entry.id,
      new Date(Date.now() - 60_000).toISOString(),
    );

    await expect(
      callRpc<number>('confirm_raffle_verification', {
        p_token_hash: tokenHash,
        p_receipt_token_hash: `receipt-${uniqueSlug()}`,
        p_event_slug: campaign.slug,
      }),
    ).rejects.toThrow('Verification token has expired');

    const { data: entryAfter, error } = await supabase
      .from('raffle_entries')
      .select('state, number')
      .eq('id', entry.id)
      .single();

    expect(error).toBeNull();
    expect(entryAfter).toMatchObject({ state: 'PENDING', number: null });
  });

  it('leases an outbox job to only one concurrent worker', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'outbox@example.com' });
    const { data: job, error } = await supabase
      .from('email_outbox')
      .insert({ entry_id: entry.id, kind: 'VERIFICATION' })
      .select('id')
      .single();

    if (error || !job) {
      throw new Error(error?.message ?? 'Outbox job was not created');
    }

    type ClaimedJob = {
      id: string;
      attempt_count: number;
      lease_expires_at: string;
    };
    const claims = await Promise.all([
      callRpc<ClaimedJob[]>('claim_email_outbox_job'),
      callRpc<ClaimedJob[]>('claim_email_outbox_job'),
    ]);
    const claimedJobs = claims.flat();

    expect(claimedJobs).toHaveLength(1);
    expect(claimedJobs[0]).toMatchObject({ id: job.id, attempt_count: 1 });
    expect(new Date(claimedJobs[0].lease_expires_at).getTime()).toBeGreaterThan(Date.now());

    const { data: leasedJob, error: leasedJobError } = await supabase
      .from('email_outbox')
      .select('status, attempt_count, lease_expires_at')
      .eq('id', job.id)
      .single();

    expect(leasedJobError).toBeNull();
    expect(leasedJob).toMatchObject({ status: 'PROCESSING', attempt_count: 1 });
    expect(new Date(leasedJob?.lease_expires_at ?? '').getTime()).toBeGreaterThan(Date.now());
  });

  it('reclaims an available failed outbox job', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'retry@example.com' });
    const { data: job, error } = await supabase
      .from('email_outbox')
      .insert({
        entry_id: entry.id,
        kind: 'VERIFICATION',
        status: 'FAILED',
        available_at: new Date(Date.now() - 1_000).toISOString(),
      })
      .select('id')
      .single();

    if (error || !job) {
      throw new Error(error?.message ?? 'Failed outbox job was not created');
    }

    type ClaimedJob = {
      id: string;
      attempt_count: number;
      lease_expires_at: string;
    };
    const claimedJobs = await callRpc<ClaimedJob[]>('claim_email_outbox_job');

    expect(claimedJobs).toHaveLength(1);
    expect(claimedJobs[0]).toMatchObject({ id: job.id, attempt_count: 1 });
    expect(new Date(claimedJobs[0].lease_expires_at).getTime()).toBeGreaterThan(Date.now());

    const { data: reclaimedJob, error: reclaimedJobError } = await supabase
      .from('email_outbox')
      .select('status, attempt_count, lease_expires_at')
      .eq('id', job.id)
      .single();

    expect(reclaimedJobError).toBeNull();
    expect(reclaimedJob).toMatchObject({ status: 'PROCESSING', attempt_count: 1 });
    expect(new Date(reclaimedJob?.lease_expires_at ?? '').getTime()).toBeGreaterThan(Date.now());
  });
});
