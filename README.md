# JFCA 2026 Lucky Draw

The QR raffle registration application for JFCA 2026.

A visitor scans a QR code, submits their address, confirms it through an emailed
link, and is issued a permanent Lucky Draw number. Results are announced at the
venue; the application holds no prize data and never says who won.

- **Visitor pages are English only.** The Japanese copy and the language
  switcher were removed; `raffle_entries.locale` is constrained to `'en'`.
- **Admin pages are Japanese only**, restricted to `@chairman.jp` addresses via
  a Supabase magic link.
- Production: `https://luckydraw.livapon.com`, deployed on Vercel, backed by
  Supabase project `eyysljemlsghdxjaxjbn`.

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
VERIFICATION_TOKEN_SECRET=<any long string>
RECEIPT_TOKEN_SECRET=<any long string>
```

The two secrets are only needed by the end-to-end suite, which rebuilds an
emailed link from the token row id the same way the mailer does. Without them
`e2e/public-journey.spec.ts` skips itself.

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
  'jfca-2026-terms-v1'
)
on conflict (slug) do nothing;
```

### Running the app locally

Create `.env.local` (gitignored) from `.env.example`. For local work the
Supabase values are the ones `pnpm exec supabase status -o json` prints, and:

```dotenv
MAIL_DELIVERY_MODE=log
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Those are Cloudflare's published always-pass test credentials. Production
refuses them at startup.

The seeded campaign is `DRAFT` with no dates, so the page shows "entries are not
open yet". To see the form, open it:

```sql
update public.campaigns
set status = 'SCHEDULED',
    opens_at = now() - interval '1 hour',
    draw_starts_at = now() + interval '2 days'
where slug = 'jfca-2026';
```

With `MAIL_DELIVERY_MODE=log`, the confirmation link is printed to the server
console, so the whole journey can be walked without a mailbox.

### The admin screens locally

`/admin` needs a signed-in operator, and `getOperatorSession()` accepts an
account only if its address is `@chairman.jp`, its email is confirmed, **and**
it already has an `ADMIN_LOGIN` audit row — so the session has to be created by
walking the real magic-link flow at least once.

Local Supabase captures outgoing mail in Mailpit at `http://127.0.0.1:54324`,
so sign in at `/admin/login`, open the newest message there, and follow the
link. Request the link from the form rather than the Auth API directly: the
form's browser client sets the PKCE verifier cookie that `/auth/callback`
needs, and a link requested any other way comes back as an implicit-flow token
the callback deliberately refuses.

### Test mode

With an operator session, `/{eventSlug}?test=1` runs the real journey with
every entry marked `is_test`. Requested without a session it silently serves
the ordinary page, and the flag is re-verified server-side before anything is
written, so it grants nothing on its own.

A test entry takes its number from a separate sequence starting at
`900000001`, skips the schedule, the rate limits and the captcha, and is
excluded from the dashboard counts and the CSV export. Submitting the same
address again resets the previous rehearsal and re-runs the whole journey,
including both emails, so one address can be reused indefinitely. Submitting a
test entry on an address a real entry already holds is refused rather than
overwriting that entrant.

`/admin/preview` renders the number-reveal screen on demand, with no entry and
no email, for checking the animation alone.

### End-to-end tests

Install the Playwright Chromium browser once with
`pnpm exec playwright install chromium`. `pnpm test:e2e` runs everything under
`e2e/`, starting its own development server on **port 3001** (it refuses to
reuse a running one, so stop any `next dev` on that port first):

- `public-journey.spec.ts` — the real form, the confirmation dialog, and the
  number page against the local database.
- `admin.spec.ts` — sign-in, the campaign controls, search, and the export.
- `production-smoke.spec.ts` — read-only checks against a deployed origin. It
  only runs when `SMOKE_BASE_URL` is set, which also suppresses the local
  server; `SMOKE_EVENT_SLUG` overrides the slug it looks for (`jfca-2026`).

Individual specs skip themselves when the environment they need is absent.

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

Surrounding whitespace is trimmed before the value is checked, because pasting
into the Vercel dashboard leaves a trailing newline often enough that a stray
`"send\n"` once took every mail-sending route in production down at boot.

The **operator sign-in link does not go through Resend.** It is sent by Supabase
Auth's built-in sender (`noreply@mail.app.supabase.io`), which has its own
limits: 30 emails an hour project-wide, raised from the default of 2, plus a
60-second cooldown per address that cannot be configured.

`.github/workflows/email-outbox.yml` calls the worker on a `*/5` schedule —
GitHub Actions' shortest supported interval, and independent of the Vercel plan
tier, which matters because Vercel Cron on the Hobby plan runs at most once a
day. **The schedule is a request, not a promise:** measured over 13 consecutive
runs, the real gap was a median of 88 minutes (58–197). Treat the schedule as
eventual and the Actions tab's "Run workflow" as the lever when it matters.
The endpoint requires `Authorization: Bearer ${CRON_SECRET}` and compares the
value in constant time. Set two GitHub Actions repository secrets before the
first deploy — `APP_URL` (the production origin) and `CRON_SECRET` (matching
the Vercel environment variable of the same name) — or every call 401s and no
retry ever runs. The workflow can also be run on demand from the Actions tab
(`workflow_dispatch`), which is useful for confirming it works before the event.

To look at the rendered emails:

```bash
pnpm email:preview
```

## Going live

These documents own the deployment:

- [docs/operations/prelaunch-checklist.md](docs/operations/prelaunch-checklist.md)
  — Supabase, Resend, Turnstile, Vercel, the legal wording, the event schedule,
  and the manual checks that must pass **before the QR code is printed**.
- [docs/operations/staging.md](docs/operations/staging.md) — how staging is
  configured so nothing real can be sent, and how to run the load test.
- [docs/operations/on-site-runbook.md](docs/operations/on-site-runbook.md) —
  what the operator does at the venue, including the one thing most likely to
  surprise them: a shared venue network makes many visitors look like one IP.
- [docs/operations/monitoring.md](docs/operations/monitoring.md) — the error log,
  the alert webhook, and the external monitor on `/api/health`. Three of its four
  layers are off until somebody switches them on.
- [docs/operations/readiness-gaps.md](docs/operations/readiness-gaps.md) — what
  is still unverified or missing before this can be called ready, with a deadline
  against each item.

The schedule is data, not code. Opening and draw times are set on the campaign
row; registration closes automatically 30 minutes before the draw starts. No
prize information exists anywhere in this application.

### Load test

Run against staging only, where `MAIL_DELIVERY_MODE=log` and the Turnstile test
secret are configured. Production refuses both.

```bash
pnpm load-test --url https://staging.example.com --rate 100 --seconds 30
```

The target is 100 verification requests per second with no server errors, no
duplicate numbers, and a controlled 429 for traffic over the limit. The script
prints the SQL to check for duplicates and to clean up afterwards.

## Environment variables

`lib/config/startup.ts` runs at boot through `instrumentation.ts` and refuses to
start a production deployment that is missing any of the required values, so a
mistake is a failed deploy rather than a silent one.

| Variable | Required | What it is for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser client, used only by the operator sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Every data path; server-only, never reaches the browser |
| `NEXT_PUBLIC_APP_URL` | yes | Origin baked into the emailed links |
| `RESEND_API_KEY` | yes | Transactional mail — still required in `log` mode |
| `RAFFLE_EMAIL_FROM` | no | Sender, defaults to `LIVAPON <info@chairman.jp>` |
| `TURNSTILE_SECRET_KEY` | yes | Server-side captcha check; production refuses Cloudflare's test secrets |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | yes | Captcha widget |
| `VERIFICATION_TOKEN_SECRET` | yes | Derives the confirmation link |
| `RECEIPT_TOKEN_SECRET` | yes | Derives the permanent number-page link |
| `CRON_SECRET` | yes | Bearer credential for the outbox retry worker |
| `MAIL_DELIVERY_MODE` | no | `send` (default) or `log` |
| `RAFFLE_IP_REQUEST_LIMIT` | no | Writes per IP per 24h, default 500 — the venue-network lever |
| `RAFFLE_EMAIL_REQUEST_LIMIT` | no | Writes per address per 24h, default 5 |
| `ALERT_WEBHOOK_URL` | no | Slack/Discord/Google Chat incoming webhook for server errors |
| `OUTBOX_BACKLOG_THRESHOLD` | no | Queue depth `/api/health` calls `degraded`, default 50 |
| `SMOKE_BASE_URL` / `SMOKE_EVENT_SLUG` | no | Point the smoke suite at a deployed origin |

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
