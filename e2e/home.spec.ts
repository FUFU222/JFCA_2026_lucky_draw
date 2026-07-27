import { expect, test } from 'playwright/test';

test('renders the lucky draw landing page', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('main')).toHaveText('JFCA 2026 Lucky Draw');
});
