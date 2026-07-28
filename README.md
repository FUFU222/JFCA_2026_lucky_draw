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

`tests/setup.ts` loads this file, so no shell export is needed. Two suites use
these variables and skip only when they are absent locally; in CI a missing
database is a hard failure, because a skipped schema suite once let a migration
that Postgres could not even parse through the pipeline.

With local Supabase running, apply the migrations and seed before running them:

```bash
pnpm exec supabase db reset
pnpm test --run tests/integration/schema.test.ts tests/integration/raffle-repository.test.ts
```

`schema.test.ts` covers the tables, constraints, and RPCs.
`raffle-repository.test.ts` drives the real Supabase adapter and the
registration service end to end, so the SQL the application depends on is
exercised rather than assumed.

Both connect with `SUPABASE_SERVICE_ROLE_KEY`, because browser clients have no
direct database access and never receive that key.

### Production campaign seed

Before deploying the application, run the following as the project owner in the
Supabase SQL Editor (or apply the checked-in migration and
`supabase/seed.sql` through the normal deployment pipeline). It creates the
initial campaign only; if that slug already exists, it leaves the existing
schedule, status, number counter, and terms version untouched. The initial
timestamps are intentionally `NULL`; an operator must set UTC instants later
and explicitly change the campaign to `SCHEDULED` before public registration
can open.

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
on conflict (slug) do nothing;
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

## Transactional email

Both messages are React Email templates under `emails/`, rendered to HTML and a
plain-text alternative by `lib/email/templates.ts`. The sender is
`LIVAPON <info@chairman.jp>`.

Delivery is inline first and durable second. A visitor standing at the venue
gets their verification link immediately; if the provider refuses it, the
message is armed in `email_outbox` and `/api/internal/email-outbox` retries it.
The retry worker rebuilds the permanent receipt link from the stored hash, so
nothing has to keep a bearer token around to make a retry possible.

- `MAIL_DELIVERY_MODE=send` — deliver through Resend.
- `MAIL_DELIVERY_MODE=log` — render the real template and record a successful
  delivery without contacting a provider. Use it for staging and load tests.
  Production refuses it at startup rather than silently swallowing every
  message.

`vercel.json` schedules the worker every minute. It requires
`Authorization: Bearer ${CRON_SECRET}` and compares the value in constant time.
Set `CRON_SECRET` in Vercel before the first deploy, or the endpoint refuses
every request, including the cron.

To look at the rendered emails:

```bash
pnpm email:preview
```

## Token secrets

The server never stores a bearer token, only its SHA-256 hash, so both links are
derived from a stored identifier and a secret.

- `RECEIPT_TOKEN_SECRET` derives the permanent number-page URL. Generate a long
  random value before launch and never change it: every receipt link already in
  a visitor's inbox stops resolving if you do.
- `VERIFICATION_TOKEN_SECRET` derives the confirmation link from the token row
  id, which is what lets a resend send the same link without the plaintext ever
  being written down. Rotating it invalidates every link that has been sent and
  not yet used.
