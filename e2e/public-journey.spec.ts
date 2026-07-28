import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from 'playwright/test';

import { deriveVerificationToken } from '../lib/raffle/tokens';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const verificationSecret = process.env.VERIFICATION_TOKEN_SECRET;

/**
 * The journey is driven against a real database and a real Turnstile test key.
 * It skips only when the local environment has not been set up, exactly like
 * the integration suites.
 */
test.skip(
  !url || !serviceRoleKey || !verificationSecret,
  'Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VERIFICATION_TOKEN_SECRET in .env.local',
);

let supabase: SupabaseClient;
const createdCampaignIds: string[] = [];

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createOpenCampaign() {
  const slug = `e2e-${unique()}`;
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      slug,
      title: 'End to end event',
      status: 'SCHEDULED',
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      draw_starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      terms_version: 'e2e-v1',
    })
    .select('id, slug')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Campaign was not created');
  createdCampaignIds.push(data.id);
  return data as { id: string; slug: string };
}

/** Rebuilds the emailed link the way the mailer does, from the stored token id. */
async function verificationLinkFor(campaignId: string) {
  const { data: entry } = await supabase
    .from('raffle_entries')
    .select('id')
    .eq('campaign_id', campaignId)
    .single();

  const { data: token } = await supabase
    .from('verification_tokens')
    .select('id')
    .eq('entry_id', entry!.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return deriveVerificationToken(token!.id, verificationSecret!);
}

test.beforeAll(() => {
  supabase = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
});

test.afterAll(async () => {
  if (createdCampaignIds.length === 0) return;
  const { data: entries } = await supabase
    .from('raffle_entries')
    .select('id')
    .in('campaign_id', createdCampaignIds);
  const entryIds = (entries ?? []).map((entry) => entry.id);

  if (entryIds.length > 0) {
    await supabase.from('email_deliveries').delete().in('entry_id', entryIds);
    await supabase.from('email_outbox').delete().in('entry_id', entryIds);
    await supabase.from('verification_tokens').delete().in('entry_id', entryIds);
  }
  await supabase.from('raffle_entries').delete().in('campaign_id', createdCampaignIds);
  await supabase.from('campaigns').delete().in('id', createdCampaignIds);
});

test('a visitor enters, confirms, and receives one number', async ({ page }) => {
  const campaign = await createOpenCampaign();
  const email = `journey-${unique()}@example.com`;

  await page.goto(`/${campaign.slug}`);
  await expect(page.getByRole('heading', { name: 'Get your Lucky Draw number' })).toBeVisible();

  await page.getByLabel('First name').fill('Ada');
  await page.getByLabel('Province / State / Region').fill('Ontario');
  await page.getByLabel(/Email address/).fill(email);
  await page.getByRole('checkbox').check();

  const submit = page.getByRole('button', { name: 'Send confirmation email' });
  await expect(submit).toBeEnabled({ timeout: 15_000 });

  // Cancelling the dialog must send nothing.
  await submit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(email);
  await expect(dialog.getByRole('button', { name: 'Go back' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Go back' }).click();
  await expect(dialog).toBeHidden();
  expect(await supabase.from('raffle_entries').select('id').eq('campaign_id', campaign.id)).toMatchObject({
    data: [],
  });

  await submit.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send confirmation email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Opening the link only offers the action; it must not issue a number.
  const token = await verificationLinkFor(campaign.id);
  await page.goto(`/${campaign.slug}/verify/${token}`);
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  const { data: beforeConfirm } = await supabase
    .from('raffle_entries')
    .select('state, number')
    .eq('campaign_id', campaign.id)
    .single();
  expect(beforeConfirm).toMatchObject({ state: 'PENDING', number: null });

  await page.getByRole('button', { name: 'Confirm and get my number' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Get my number' }).click();

  await expect(page.getByText('No. 10000')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${campaign.slug}/number/`));
  const receiptUrl = page.url();

  // A second visit to the used link cannot issue another number.
  await page.goto(`/${campaign.slug}/verify/${token}`);
  await expect(page.getByRole('heading', { name: 'This link cannot be used' })).toBeVisible();

  const { data: campaignAfter } = await supabase
    .from('campaigns')
    .select('next_number')
    .eq('id', campaign.id)
    .single();
  expect(campaignAfter?.next_number).toBe(10_001);

  // The receipt link has no expiry and keeps working.
  await page.goto(receiptUrl);
  await expect(page.getByText('No. 10000')).toBeVisible();
  await expect(page.getByText(/announced at the venue/i)).toBeVisible();
});

test('a Japanese visitor sees the journey in Japanese', async ({ page }) => {
  const campaign = await createOpenCampaign();
  const email = `journey-ja-${unique()}@example.com`;

  await page.goto(`/${campaign.slug}`);
  await page.getByRole('button', { name: '日本語' }).click();
  await expect(page.getByRole('heading', { name: '抽選番号を受け取る' })).toBeVisible();

  await page.getByLabel(/メールアドレス/).fill(email);
  await page.getByRole('checkbox').check();

  const submit = page.getByRole('button', { name: '確認メールを送信' });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  await page.getByRole('dialog').getByRole('button', { name: '確認メールを送信' }).click();
  await expect(page.getByRole('heading', { name: 'メールをご確認ください' })).toBeVisible();

  const token = await verificationLinkFor(campaign.id);
  await page.goto(`/${campaign.slug}/verify/${token}`);
  await page.getByRole('button', { name: '確認して番号を受け取る' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '番号を受け取る' }).click();

  await expect(page.getByRole('heading', { name: 'ご応募を受け付けました' })).toBeVisible();
  await expect(page.getByText('No. 10000')).toBeVisible();
  // The label stays in English because that is the wording the design specifies.
  await expect(page.getByText('Your Lucky Draw Number')).toBeVisible();
});

test('a reload in the same tab restores what was typed', async ({ page }) => {
  const campaign = await createOpenCampaign();

  await page.goto(`/${campaign.slug}`);
  await page.getByLabel('First name').fill('Ada');
  await page.getByLabel(/Email address/).fill('draft@example.com');

  await page.reload();

  await expect(page.getByLabel('First name')).toHaveValue('Ada');
  await expect(page.getByLabel(/Email address/)).toHaveValue('draft@example.com');
});

test('an expired link sends the visitor back to the form', async ({ page }) => {
  const campaign = await createOpenCampaign();
  const email = `expired-${unique()}@example.com`;

  await page.goto(`/${campaign.slug}`);
  await page.getByLabel(/Email address/).fill(email);
  await page.getByRole('checkbox').check();
  const submit = page.getByRole('button', { name: 'Send confirmation email' });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send confirmation email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const token = await verificationLinkFor(campaign.id);
  const { data: entry } = await supabase
    .from('raffle_entries')
    .select('id')
    .eq('campaign_id', campaign.id)
    .single();
  await supabase
    .from('verification_tokens')
    .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
    .eq('entry_id', entry!.id);

  await page.goto(`/${campaign.slug}/verify/${token}`);
  await expect(page.getByRole('heading', { name: 'This link cannot be used' })).toBeVisible();

  await page.getByRole('link', { name: 'Go to the entry form' }).click();
  await expect(page.getByRole('heading', { name: 'Get your Lucky Draw number' })).toBeVisible();
});

test('the terms page belongs to the event and links back to it', async ({ page }) => {
  const campaign = await createOpenCampaign();

  await page.goto(`/${campaign.slug}`);
  await page.getByRole('link', { name: 'Terms' }).click();

  await expect(page).toHaveURL(`/${campaign.slug}/terms`);
  await expect(page.getByRole('heading', { name: 'Lucky Draw Terms' })).toBeVisible();
  await expect(page.getByText('One entry per person')).toBeVisible();

  await page.getByRole('link', { name: 'Back to the entry form' }).click();
  await expect(page).toHaveURL(`/${campaign.slug}`);
});

test('an unknown event is not found', async ({ page }) => {
  const response = await page.goto('/no-such-event');

  expect(response?.status()).toBe(404);
});
