import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './e2e',
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
