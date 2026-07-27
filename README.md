# JFCA 2026 Lucky Draw

The QR raffle registration application for JFCA 2026.

## Prerequisites

- Node.js 22.x (see `.nvmrc`)
- pnpm 11.9.0
- Docker Desktop (or another running Docker daemon) for local Supabase

## Local setup

Install dependencies with `pnpm install`, then copy `.env.example` to `.env.local` and provide the appropriate development credentials.

### Local Supabase for tests

Docker must be running before `pnpm exec supabase start`. The command prints a local API URL, anon key, and service-role key. Create the gitignored `.env.test.local` file with those values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key printed by Supabase>
SUPABASE_SERVICE_ROLE_KEY=<service_role key printed by Supabase>
```

Do not commit `.env.test.local`.

### End-to-end tests

Install the Playwright Chromium browser once with `pnpm exec playwright install chromium`. `pnpm test:e2e` starts the Next.js development server automatically and runs the E2E smoke tests in `e2e/*.spec.ts`.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm audit --prod --audit-level high
pnpm audit --audit-level high
```

`RECEIPT_TOKEN_SECRET` is production-only. Generate a long random value before launch and keep it unchanged afterwards: it derives permanent receipt URLs.
