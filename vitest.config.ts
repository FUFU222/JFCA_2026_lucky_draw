import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/{unit,integration}/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    // The integration suites share one Supabase database, and the outbox claim
    // is global by design: two files running at once can lease each other's
    // jobs. Running files in sequence keeps the suite deterministic, and the
    // whole run still finishes in a couple of seconds.
    fileParallelism: false,
  },
});
