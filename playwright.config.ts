import { existsSync } from 'node:fs';

import { defineConfig, devices } from 'playwright/test';

// The dev server reads `.env.local` itself; the specs need the same values to
// reach the database directly, and Playwright does not load dotenv files.
for (const file of ['.env.local', '.env.test.local']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  testDir: './e2e',
  // The public journey writes to one shared database, so specs run in order.
  workers: 1,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // The smoke suite runs against an already-deployed origin, so it must not
  // start a local server or point at one.
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: 'pnpm exec next dev --port 3001',
        // The browser suite reads verification tokens out of the database, so
        // it never needed a real provider — and calling one made it flaky.
        // Resend rejects `example.com` addresses, and the round trip to that
        // rejection can take longer than the assertion waiting on the screen
        // behind it, so the journey spec failed intermittently on whatever
        // Resend's latency happened to be. Log mode renders the same template
        // and records the same delivery without leaving the machine.
        // Production refuses this value at startup.
        env: { MAIL_DELIVERY_MODE: 'log' },
        url: 'http://localhost:3001',
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
