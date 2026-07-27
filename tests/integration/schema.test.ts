import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

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

function uniqueSlug() {
  return `schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

describeWithSupabase('lucky draw schema', () => {
  beforeAll(() => {
    supabase = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
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
    const slug = uniqueSlug();
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({ slug, title: 'Schema test', status: 'DRAFT', terms_version: 'test-v1' })
      .select('id')
      .single();

    if (error || !campaign) {
      throw new Error(error?.message ?? 'Campaign was not created');
    }

    await expect(createEntry({ campaignId: campaign.id, email: 'first@example.com', number: 10_000 }))
      .resolves.toBeDefined();
    await expect(createEntry({ campaignId: campaign.id, email: 'second@example.com', number: 10_000 }))
      .rejects.toThrow();
  });

  it('rejects a duplicate normalized email within one campaign', async () => {
    const slug = uniqueSlug();
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({ slug, title: 'Schema test', status: 'DRAFT', terms_version: 'test-v1' })
      .select('id')
      .single();

    if (error || !campaign) {
      throw new Error(error?.message ?? 'Campaign was not created');
    }

    await expect(createEntry({ campaignId: campaign.id, email: 'user@example.com' }))
      .resolves.toBeDefined();
    await expect(createEntry({ campaignId: campaign.id, email: 'USER@example.com' }))
      .rejects.toThrow();
  });
});
