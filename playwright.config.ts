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
  webServer: {
    command: 'pnpm exec next dev --port 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
