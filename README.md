# JFCA 2026 Lucky Draw

The QR raffle registration application for JFCA 2026.

## Prerequisites

- Node.js and pnpm
- Docker Desktop (or another running Docker daemon) for local Supabase

## Local setup

Install dependencies with `pnpm install`, then copy `.env.example` to `.env.local` and provide the appropriate development credentials.

### Local Supabase for tests

Docker must be running before `pnpm exec supabase start`. The command prints a local API URL, anon key, and service-role key. Copy those values to the gitignored `.env.test.local` file:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key printed by Supabase>
SUPABASE_SERVICE_ROLE_KEY=<service_role key printed by Supabase>
```

The repository includes placeholder local values in `.env.test.local` so the required variable names are clear; replace them with the values printed by your running local stack. Do not commit this file.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

`RECEIPT_TOKEN_SECRET` is production-only. Generate a long random value before launch and keep it unchanged afterwards: it derives permanent receipt URLs.
