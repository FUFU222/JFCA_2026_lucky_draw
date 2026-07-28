import { expect, test } from 'playwright/test';

/**
 * Read-only checks against a deployed environment. Nothing here creates an
 * entry, so it is safe to run against production immediately after a deploy.
 *
 *   SMOKE_BASE_URL=https://luckydraw.livapon.com pnpm test:e2e -- production-smoke
 */
const baseUrl = process.env.SMOKE_BASE_URL?.replace(/\/+$/, '');
const eventSlug = process.env.SMOKE_EVENT_SLUG ?? 'jfca-2026';

test.skip(!baseUrl, 'Set SMOKE_BASE_URL to the deployed origin');
test.describe.configure({ mode: 'serial' });

test('the event URL renders without downgrading the connection', async ({ page }) => {
  const response = await page.goto(`${baseUrl}/${eventSlug}`);

  expect(response?.status()).toBe(200);
  // A redirect that drops TLS is the failure worth catching here; the scheme of
  // the URL under test is what decides whether that is being checked.
  expect(new URL(page.url()).protocol).toBe(new URL(baseUrl!).protocol);
  await expect(page.locator('img[alt="LIVAPON"]')).toBeVisible();
});

test('the page offers both languages', async ({ page }) => {
  await page.goto(`${baseUrl}/${eventSlug}`);

  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  await expect(page.getByRole('button', { name: '日本語' })).toBeVisible();
});

test('the terms are reachable from the entry page', async ({ page }) => {
  const response = await page.goto(`${baseUrl}/${eventSlug}/terms`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the bare domain forwards to the active event', async ({ page }) => {
  await page.goto(`${baseUrl}/`);

  await expect(page).toHaveURL(new RegExp(`/${eventSlug}$`));
});

test('an unknown event is not found', async ({ page }) => {
  const response = await page.goto(`${baseUrl}/no-such-event-smoke-check`);

  expect(response?.status()).toBe(404);
});

test('an unusable confirmation link says so instead of failing', async ({ page }) => {
  // 43 base64url characters, the shape of a real token, but not a real one.
  const shaped = 'A'.repeat(43);
  const response = await page.goto(`${baseUrl}/${eventSlug}/verify/${shaped}`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/cannot be used|ご利用いただけません/);
});

test('the operator area is closed to the public', async ({ page }) => {
  await page.goto(`${baseUrl}/admin`);

  await expect(page).toHaveURL(/\/admin\/login/);
});

test('the retry worker refuses a request without the cron credential', async ({ request }) => {
  const response = await request.post(`${baseUrl}/api/internal/email-outbox`);

  expect(response.status()).toBe(401);
});

test('the registration endpoint rejects a submission with no captcha token', async ({ request }) => {
  const response = await request.post(`${baseUrl}/api/campaigns/${eventSlug}/entries`, {
    data: { email: 'smoke@example.invalid', terms_consent: true, locale: 'en' },
  });

  // Refused before anything is written: no captcha token means no entry.
  expect([400, 403]).toContain(response.status());
});
