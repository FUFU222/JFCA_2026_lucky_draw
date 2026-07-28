import { existsSync } from 'node:fs';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Testing Library only auto-cleans when Vitest globals are on, and they are
// not. Without this, a second render of the same component finds two of
// everything.
afterEach(cleanup);

// Vitest does not populate `process.env` from dotenv files, so the Supabase
// integration suites would silently skip even after the documented README
// setup. Load the gitignored local credentials without overriding an
// environment that already supplies them (CI, staging).
const LOCAL_TEST_ENV_FILE = '.env.test.local';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(LOCAL_TEST_ENV_FILE)) {
  process.loadEnvFile(LOCAL_TEST_ENV_FILE);
}
