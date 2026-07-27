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

The schema integration test uses these two variables and deliberately skips only
when they are absent. With local Supabase running, apply the migration and seed
before running it:

```bash
pnpm exec supabase db reset
pnpm test --run tests/integration/schema.test.ts
```

The test connects with `SUPABASE_SERVICE_ROLE_KEY`, because browser clients have
no direct database access and never receive that key.

### Production campaign seed

Before deploying the application, run the following as the project owner in the
Supabase SQL Editor (or apply the checked-in migration and
`supabase/seed.sql` through the normal deployment pipeline). It creates or
resets only the initial campaign. The two timestamps are intentionally `NULL`;
an operator must set UTC instants later and explicitly change the campaign to
`SCHEDULED` before public registration can open.

```sql
insert into public.campaigns (
  slug, title, opens_at, draw_starts_at, status, next_number, terms_version
)
values (
  'jfca-2026',
  'Japan Festival Canada 2026',
  null,
  null,
  'DRAFT',
  10000,
  'jfca-2026-terms-v1-placeholder'
)
on conflict (slug) do update
set
  title = excluded.title,
  opens_at = null,
  draw_starts_at = null,
  status = 'DRAFT',
  next_number = 10000,
  terms_version = excluded.terms_version;
```

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
