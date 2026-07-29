import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from 'playwright/test';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
/** Supabase's local mail catcher; the sign-in link is read from it. */
const MAILPIT = 'http://127.0.0.1:54324';

test.skip(!url || !serviceRoleKey, 'Set the Supabase variables in .env.local');

let supabase: SupabaseClient;

test.beforeAll(() => {
  supabase = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
});

async function latestSignInLink(address: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await fetch(`${MAILPIT}/api/v1/messages?limit=20`).then((r) => r.json());
    const message = (list.messages ?? []).find(
      (candidate: { To: Array<{ Address: string }> }) =>
        candidate.To?.some((to) => to.Address === address),
    );
    if (message) {
      const detail = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`).then((r) => r.json());
      const body: string = detail.HTML || detail.Text || '';
      const href = /href="([^"]+auth\/v1\/verify[^"]*)"/.exec(body)?.[1];
      if (href) return href.replaceAll('&amp;', '&');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No sign-in link arrived for ${address}`);
}

/**
 * Supabase enforces a cooldown between sign-in links sent to the same address,
 * so each spec uses its own operator. Every one of them is in the domain, which
 * is the only thing that grants access.
 */
function operatorAddress(name: string) {
  return `${name}@chairman.jp`;
}

async function signIn(page: Page, address: string) {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});

  await page.goto('/admin/login');
  await page.getByLabel('運営者のメールアドレス').fill(address);
  await page.getByRole('button', { name: 'サインインリンクを送る' }).click();
  await expect(
    page.getByRole('heading', { name: 'メールをご確認ください' }),
    'the sign-in link was not sent',
  ).toBeVisible();

  await page.goto(await latestSignInLink(address));
  await expect(page).toHaveURL(/\/admin$/);
}

test('the dashboard is closed to anyone without an operator session', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole('heading', { name: 'Lucky Draw 管理画面' })).toBeVisible();
});

test('an address outside the operator domain never gets a link', async ({ page }) => {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});

  await page.goto('/admin/login');
  await page.getByLabel('運営者のメールアドレス').fill('person@example.com');
  await page.getByRole('button', { name: 'サインインリンクを送る' }).click();

  await expect(page.getByText('chairman.jp のアドレスを使用してください。')).toBeVisible();
  const list = await fetch(`${MAILPIT}/api/v1/messages?limit=5`).then((r) => r.json());
  expect(list.messages ?? []).toHaveLength(0);
});

test('an operator signs in, and the login is recorded', async ({ page }) => {
  const operator = operatorAddress('a.tanaka');
  await signIn(page, operator);

  await expect(page.getByText(operator)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Japan Festival Canada 2026' })).toBeVisible();

  const { data } = await supabase
    .from('admin_audit_logs')
    .select('action, metadata')
    .eq('action', 'ADMIN_LOGIN')
    .order('created_at', { ascending: false })
    .limit(1);
  expect(data?.[0]?.metadata).toMatchObject({ actor_email: operator });
});

test('pausing and resuming needs a confirmation and is recorded', async ({ page }) => {
  // The seeded campaign starts DRAFT with no dates, which only offers "Start
  // entries now" — pause/resume only appear once it is actually scheduled.
  await supabase
    .from('campaigns')
    .update({
      status: 'SCHEDULED',
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      draw_starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
    .eq('slug', 'jfca-2026');

  await signIn(page, operatorAddress('ops.pause'));

  // Cancel changes nothing.
  await page.getByRole('button', { name: /受付を一時停止|受付を再開/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '受付を一時停止' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '受付を一時停止' }).click();
  await expect(page.getByText('PAUSED')).toBeVisible();

  const { data: paused } = await supabase
    .from('admin_audit_logs')
    .select('action')
    .eq('action', 'PAUSE_REGISTRATION')
    .limit(1);
  expect(paused).toHaveLength(1);

  await page.getByRole('button', { name: '受付を再開' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '受付を再開' }).click();
  await expect(page.getByText('SCHEDULED')).toBeVisible();
});

test('the export asks first and records who asked', async ({ page }) => {
  const operator = operatorAddress('ops.export');
  await signIn(page, operator);
  await page.goto('/admin/entries');

  await page.getByRole('button', { name: 'CSVをエクスポート' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('メールアドレス');
  await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused();

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'CSVをダウンロード' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('jfca-2026-entries.csv');

  const { data } = await supabase
    .from('admin_audit_logs')
    .select('action, metadata')
    .eq('action', 'EXPORT_CSV')
    .order('created_at', { ascending: false })
    .limit(1);
  expect(data?.[0]?.metadata).toMatchObject({ actor_email: operator });
  // The audit trail records the request, not the personal data in the file.
  expect(JSON.stringify(data?.[0]?.metadata)).not.toContain('@example.com');
});

test('search finds an entry by address and by issued number', async ({ page }) => {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('slug', 'jfca-2026')
    .single();

  const email = `admin-search-${Date.now()}@example.com`;
  await supabase.from('raffle_entries').insert({
    campaign_id: campaign!.id,
    email,
    locale: 'en',
    terms_version: 'e2e',
    terms_consented_at: new Date().toISOString(),
    state: 'VERIFIED',
    number: 99_999,
    verified_at: new Date().toISOString(),
  });

  await signIn(page, operatorAddress('ops.search'));

  await page.goto(`/admin/entries?q=${encodeURIComponent(email)}`);
  await expect(page.getByText(email)).toBeVisible();

  await page.goto('/admin/entries?q=99999');
  await expect(page.getByText(email)).toBeVisible();

  await page.goto('/admin/entries?q=nothing-matches-this');
  await expect(page.getByText('該当する応募が見つかりませんでした。')).toBeVisible();

  await supabase.from('raffle_entries').delete().eq('email', email);
});
