import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSupabaseIntegration = Boolean(url && serviceRoleKey);
const describeWithSupabase = hasSupabaseIntegration ? describe : describe.skip;

type EntryInput = {
  campaignId: string;
  email: string;
  number?: number;
};

let supabase: SupabaseClient;
const testCampaignIds: string[] = [];
const testRateLimitKeys: string[] = [];

function uniqueSlug() {
  return `schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createCampaign() {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      slug: uniqueSlug(),
      title: 'Schema test',
      status: 'DRAFT',
      terms_version: 'test-v1',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Campaign was not created');
  }

  testCampaignIds.push(data.id);
  return data;
}

async function createEntry({ campaignId, email, number }: EntryInput) {
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

async function callRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    throw new Error(`${error.code}: ${error.message}`);
  }

  return data as T;
}

describeWithSupabase('lucky draw schema', () => {
  beforeAll(() => {
    supabase = createClient(url!, serviceRoleKey!, {
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
      .select('slug, title, status, next_number, opens_at, draw_starts_at')
      .eq('slug', 'jfca-2026')
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      slug: 'jfca-2026',
      title: 'Japan Festival Canada 2026',
      status: 'DRAFT',
      next_number: 10_000,
      opens_at: null,
      draw_starts_at: null,
    });
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
      token_hash: tokenHash,
      receipt_token_hash: receiptTokenHash,
    });
    const repeatedNumber = await callRpc<number>('confirm_raffle_verification', {
      token_hash: tokenHash,
      receipt_token_hash: receiptTokenHash,
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

  it('rejects an expired verification token without issuing a number', async () => {
    const campaign = await createCampaign();
    const entry = await createEntry({ campaignId: campaign.id, email: 'expired@example.com' });
    const tokenHash = await createVerificationToken(
      entry.id,
      new Date(Date.now() - 60_000).toISOString(),
    );

    await expect(
      callRpc<number>('confirm_raffle_verification', {
        token_hash: tokenHash,
        receipt_token_hash: `receipt-${uniqueSlug()}`,
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
