# Lucky Draw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first reusable LIVAPON Lucky Draw event (`jfca-2026`): bilingual QR registration, email verification, non-duplicated sequential number issuance, number receipt email/page, and operator administration.

**Architecture:** Build one Next.js App Router application. Public pages and Route Handlers run on Vercel; all persistent state is in Supabase Postgres; Resend sends transactional mail; Cloudflare Turnstile and server-side limits protect public writes. The server owns every database mutation and stores only hashes of bearer tokens.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, Supabase Postgres/Auth, Resend + React Email, Cloudflare Turnstile, Zod, Vitest, Playwright, pnpm.

**Authoritative service spec:** `/Users/fufu/Downloads/design.md`

---

## File structure

```text
app/
  page.tsx                                      # redirect to active campaign
  [eventSlug]/page.tsx                          # public registration page
  [eventSlug]/verify/[token]/page.tsx           # explicit verification-confirmation page
  [eventSlug]/number/[token]/page.tsx           # permanent number receipt page
  [eventSlug]/terms/page.tsx                     # event-specific Lucky Draw Terms
  api/campaigns/[eventSlug]/entries/route.ts    # create/update pending entry and send mail
  api/campaigns/[eventSlug]/entries/resend/route.ts
  api/campaigns/[eventSlug]/verify/confirm/route.ts
  auth/callback/route.ts                         # Supabase admin magic-link callback
  admin/login/page.tsx
  admin/page.tsx
  admin/entries/page.tsx
  admin/entries/export/route.ts
  admin/campaign/route.ts                        # manual pause/resume only
components/
  public/raffle-form.tsx
  public/locale-switcher.tsx
  public/verification-confirmation.tsx
  public/number-receipt.tsx
  admin/*
  ui/confirmation-dialog.tsx
emails/
  verification-email.tsx
  number-receipt-email.tsx
lib/
  campaign/config.ts
  db/server.ts
  db/types.ts
  raffle/number.ts
  raffle/service.ts
  raffle/validation.ts
  raffle/tokens.ts
  raffle/rate-limit.ts
  campaign/legal.ts
  email/resend.ts
  security/turnstile.ts
  security/admin.ts
  i18n/messages.ts
supabase/migrations/
  0001_lucky_draw.sql                            # tables, RLS, atomic RPCs
  seed.sql                                       # initial jfca-2026 campaign
tests/
  unit/*
  integration/*
e2e/*
assets/
  LIVAPON_logo_horizontal_350x.png
  LIVAPON_logo_horizontal_cropped.png
```

## Task 1: Initialize the application and quality gates

**Files:**
- Create: `package.json`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `tsconfig.json`, `.env.example`
- Create: `vitest.config.ts`, `tests/setup.ts`, `playwright.config.ts`
- Create: `.github/workflows/ci.yml`
- Test: `tests/unit/smoke.test.ts`

- [ ] **Step 1: Create the Next.js application with TypeScript, Tailwind, ESLint, App Router, and `src/` disabled.**

  Run:

  ```bash
  pnpm dlx create-next-app@latest . --ts --tailwind --eslint --app --use-pnpm --import-alias '@/*' --no-src-dir --yes
  ```

- [ ] **Step 2: Add test tooling.**

  Run:

  ```bash
  pnpm add zod @supabase/ssr @supabase/supabase-js resend @react-email/components
  pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom playwright
  pnpm exec playwright install chromium
  ```

- [ ] **Step 3: Initialize Supabase local development and commit its configuration.**

  Run:

  ```bash
  pnpm add -D supabase
  pnpm exec supabase init
  ```

  Add `supabase/config.toml` to the repository. Document that Docker must be running before `pnpm exec supabase start`; add test-only local Supabase URL/keys to `.env.test.local` (gitignored) and describe how to create them in `README.md`.

- [ ] **Step 4: Write a failing smoke test.**

  ```ts
  // tests/unit/smoke.test.ts
  import { describe, expect, it } from 'vitest';

  describe('test harness', () => {
    it('runs unit tests', () => expect(true).toBe(true));
  });
  ```

- [ ] **Step 5: Configure `test`, `test:watch`, `test:e2e`, `typecheck`, and `lint` package scripts; run every command.**

  Run:

  ```bash
  pnpm test --run
  pnpm typecheck
  pnpm lint
  ```

  Expected: all commands exit 0.

- [ ] **Step 6: Create `.env.example` without secrets.**

  Include `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_APP_URL`, `RAFFLE_EMAIL_FROM`, `RECEIPT_TOKEN_SECRET`, `CRON_SECRET`, and `MAIL_DELIVERY_MODE`. Document that `RECEIPT_TOKEN_SECRET` is a production-only long random value that must remain unchanged after launch because it derives permanent receipt URLs.

- [ ] **Step 7: Commit.**

  ```bash
  git add .
  git commit -m "chore: initialize lucky draw application"
  ```

## Task 2: Model campaign, entry, token, and audit state in Supabase

**Files:**
- Create: `supabase/migrations/0001_lucky_draw.sql`
- Create: `lib/db/types.ts`, `lib/campaign/config.ts`
- Test: `tests/integration/schema.test.ts`

- [ ] **Step 1: Write an integration test that proves the schema rejects a duplicate verified number and duplicate normalized email in one campaign.**

  ```ts
  await expect(createEntry({ campaignId, email: 'user@example.com' })).resolves.toBeDefined();
  await expect(createEntry({ campaignId, email: 'USER@example.com' })).rejects.toThrow();
  ```

- [ ] **Step 2: Run the test and verify it fails because the schema does not exist.**

- [ ] **Step 3: Add the migration.**

  Create these tables and constraints:

  ```sql
  create table campaigns (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    title text not null,
    opens_at timestamptz,
    draw_starts_at timestamptz,
    status text not null check (status in ('DRAFT','SCHEDULED','PAUSED','CLOSED')),
    next_number bigint not null default 10000,
    terms_version text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table raffle_entries (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references campaigns(id),
    email text not null,
    first_name text, last_name text, phone text, gender text,
    date_of_birth date, country text, region text,
    locale text not null check (locale in ('en','ja')),
    terms_version text not null, terms_consented_at timestamptz not null,
    state text not null check (state in ('PENDING','VERIFIED')),
    number bigint, verified_at timestamptz,
    receipt_token_hash text unique,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (campaign_id, number)
  );
  ```

  Add `create unique index raffle_entries_campaign_lower_email_key on raffle_entries (campaign_id, lower(email));`. Add `verification_tokens` with `entry_id`, `token_hash`, `expires_at`, `send_count`, `last_sent_at`, `consumed_at`; add `admin_audit_logs`; add `email_deliveries` for mail provider result/error; add `email_outbox` with one unique `(entry_id, kind)` receipt job, status, attempt count, and lease timestamps; add `rate_limit_buckets` for durable per-IP and per-email counters. Normalize email at the application boundary. Enable RLS and deny all direct anonymous access; server access uses the service role only.

- [ ] **Step 4: Add `active_campaign` and `isRegistrationOpen` helpers.**

  `SCHEDULED` means an operator has explicitly authorized automatic public opening. `isRegistrationOpen` returns true only when status is `SCHEDULED`, `opens_at <= now`, and `now < draw_starts_at - 30 minutes`; it always returns false for `DRAFT`, `PAUSED`, and `CLOSED`. Dates are UTC instants configured from the Toronto business time.

- [ ] **Step 5: Add transactional RPCs to the migration and integration-test them.**

  Add a `security definer` PostgreSQL function `consume_raffle_rate_limit(key, limit, window_seconds)` that increments or rejects a shared rate-limit bucket atomically. Add `confirm_raffle_verification(token_hash, receipt_token_hash)` that locks the token, entry, and campaign rows with `FOR UPDATE`, validates expiry/consumption, assigns `next_number`, creates the one receipt `email_outbox` job, and returns the already assigned number on a repeat confirmation. Add `claim_email_outbox_job()` using `FOR UPDATE SKIP LOCKED` so only one worker can send a job. Set a safe `search_path`, revoke `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`, and grant it only to `service_role` for all functions. The server calls these RPCs through Supabase with the service key; browser clients must never be able to call them directly.

- [ ] **Step 6: Seed the initial JFCA campaign and test it.**

  Add `supabase/seed.sql` to insert or update only `jfca-2026` with title `Japan Festival Canada 2026`, `DRAFT` status, next number `10000`, and a versioned placeholder terms version. It must intentionally leave event times unset. Add a test that the campaign is present after `pnpm exec supabase db reset`; document the production SQL/console procedure to insert this same record before deployment.

- [ ] **Step 7: Run migration and integration tests against local Supabase.**

  Run:

  ```bash
  pnpm exec supabase start
  pnpm exec supabase db reset
  pnpm test --run tests/integration/schema.test.ts
  ```

- [ ] **Step 8: Commit.**

  ```bash
  git add supabase lib tests
  git commit -m "feat: add raffle persistence schema"
  ```

## Task 3: Implement isolated raffle domain rules

**Files:**
- Create: `lib/raffle/number.ts`, `lib/raffle/tokens.ts`, `lib/raffle/validation.ts`, `lib/raffle/rate-limit.ts`
- Test: `tests/unit/number.test.ts`, `tests/unit/tokens.test.ts`, `tests/unit/validation.test.ts`

- [ ] **Step 1: Write failing tests for the sequential number formatter.**

  ```ts
  expect(formatRaffleNumber(10_000)).toBe('No. 10000');
  expect(formatRaffleNumber(100_000)).toBe('No. 100000');
  ```

- [ ] **Step 2: Implement `formatRaffleNumber(number: bigint): string` without zero padding or an upper bound.**

- [ ] **Step 3: Write failing tests for token behavior.**

  ```ts
  const token = createBearerToken();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashToken(token)).not.toBe(token);
  ```

- [ ] **Step 4: Implement 256-bit URL-safe bearer tokens, deterministic receipt-token derivation, and SHA-256 hashing. Never store a plaintext bearer token.**

  Add `deriveReceiptToken(verificationToken, secret)` using HMAC-SHA-256 with `RECEIPT_TOKEN_SECRET`, encoded URL-safe. Every retry from the same verification link derives the same permanent receipt token; only its hash is stored. Add tests proving identical verification-token inputs derive the same receipt token and different inputs do not.

- [ ] **Step 5: Write failing Zod validation tests.**

  Cover required valid email and terms consent, optional profile fields, `country` and `region` only (no street address), and `en`/`ja` locale.

- [ ] **Step 6: Implement validation and a durable rate limiter interface.**

  Define `RateLimiter.consume(key, limit, windowSeconds)`. The production implementation calls the `consume_raffle_rate_limit` RPC from Task 2; unit tests inject an in-memory fake.

- [ ] **Step 7: Run unit tests, typecheck, and commit.**

  ```bash
  pnpm test --run tests/unit
  pnpm typecheck
  git add lib tests && git commit -m "feat: add raffle domain rules"
  ```

## Task 4: Build the server-side registration, resend, and verification services

**Files:**
- Create: `lib/db/server.ts`, `lib/raffle/service.ts`, `lib/security/turnstile.ts`, `lib/email/resend.ts`
- Create: `app/api/campaigns/[eventSlug]/entries/route.ts`
- Create: `app/api/campaigns/[eventSlug]/entries/resend/route.ts`
- Create: `app/api/campaigns/[eventSlug]/verify/confirm/route.ts`
- Test: `tests/integration/raffle-service.test.ts`, `tests/integration/raffle-routes.test.ts`

- [ ] **Step 1: Define a `RaffleMailer` interface and write a failing service test for first submission.**

  Assert that it creates exactly one `PENDING` entry, creates one 24-hour verification token, stores `send_count = 1`, and queues one verification email.

  The `RaffleMailer` interface has `sendVerification` and `sendReceipt`. The test uses a fake mailer, so the service is independently testable before the real Resend adapter in Task 5.

- [ ] **Step 2: Implement `requestVerification`.**

  Verify Turnstile server-side, enforce durable email and IP limits, normalize email, upsert only `PENDING` profile data, and return a generic success message. For an existing verified email, do not change profile data or create another number. For an existing pending entry with an unexpired token, reuse that token and route every send through the resend cooldown/count logic; never create an additional token or reset its counters. Create a replacement token only after expiry.

- [ ] **Step 3: Write failing resend tests.**

  Cover a 2-minute cooldown, maximum three sends in 24 hours, same token returned for allowed resend, and no email sent when blocked.

- [ ] **Step 4: Implement `resendVerification`.**

  Do not reveal whether an email exists. Record the mail-provider result in `email_deliveries`.

- [ ] **Step 5: Write a failing verification test for concurrent confirmation.**

  ```ts
  const [a, b] = await Promise.all([confirm(token), confirm(token)]);
  expect([a.number, b.number]).toEqual([10_000n, 10_000n]);
  ```

- [ ] **Step 6: Implement `confirmVerification` through the transactional PostgreSQL RPC.**

  Derive the raw permanent receipt token from the raw verification token and `RECEIPT_TOKEN_SECRET`, pass only its hash to `confirm_raffle_verification`, and call the RPC. The RPC locks rows, rejects expired tokens, increments `campaigns.next_number`, sets `raffle_entries.number`, sets `VERIFIED` and `verified_at`, saves the receipt-token hash, and marks the verification token consumed. A repeated successful confirmation returns the existing number and derives the same receipt URL, never another number.

- [ ] **Step 7: Create the receipt outbox job and dispatch it safely.**

  The verification RPC creates the unique receipt outbox row in the same transaction as number issuance. After confirmation, attempt to claim and send that job; a process failure before sending leaves it `PENDING`, not invisible. When it reports an already verified entry, do not create another job. Test both branches, including that a send failure leaves the number valid, records an error, and remains retryable.

- [ ] **Step 8: Implement thin Route Handlers around the service; map validation/rate-limit/closed states to stable user-safe responses.**

- [ ] **Step 9: Run integration tests and commit.**

  ```bash
  pnpm test --run tests/integration/raffle-service.test.ts tests/integration/raffle-routes.test.ts
  git add app lib tests && git commit -m "feat: add verified raffle entry flow"
  ```

## Task 5: Send and render transactional emails safely

**Files:**
- Create: `emails/verification-email.tsx`, `emails/number-receipt-email.tsx`
- Modify: `lib/email/resend.ts`
- Test: `tests/unit/emails.test.ts`

- [ ] **Step 1: Write failing email-render tests.**

  Assert the verification email contains a 24-hour expiry explanation and link. Assert the receipt email has the exact visible number, `LIVAPON <info@chairman.jp>` sender, and permanent number-page link.

- [ ] **Step 2: Implement the bilingual React Email templates.**

  Use the entry locale. Include no winner/loser language. The receipt email must prominently render `Your Lucky Draw Number` and `No. 10000`.

- [ ] **Step 3: Implement the Resend adapter.**

  Set `from: 'LIVAPON <info@chairman.jp>'`; pass a descriptive tag for `verification` or `receipt`; capture provider message ID or error text in `email_deliveries`; do not roll back a verified number when receipt sending fails. Implement `processPendingOutbox(limit)` using `claim_email_outbox_job()` and mark jobs `SENT` or retryable `FAILED`.

- [ ] **Step 4: Add secure email-outbox retry processing.**

  Create `app/api/internal/email-outbox/route.ts` and `vercel.json`. Require `Authorization: Bearer ${CRON_SECRET}` and process a bounded batch. Configure Vercel Cron to call it every minute. On staging and automated tests, `MAIL_DELIVERY_MODE=log` must record a successful fake delivery without calling Resend; production must reject `log` mode at startup.

- [ ] **Step 5: Render test emails locally and inspect them.**

  Run:

  ```bash
  pnpm test --run tests/unit/emails.test.ts
  pnpm typecheck
  ```

- [ ] **Step 6: Commit.**

  ```bash
  git add emails lib tests && git commit -m "feat: add raffle email templates"
  ```

## Task 6: Implement the bilingual public journey and confirmation dialogs

**Files:**
- Create: `app/[eventSlug]/page.tsx`, `app/[eventSlug]/verify/[token]/page.tsx`, `app/[eventSlug]/number/[token]/page.tsx`
- Create: `components/public/raffle-form.tsx`, `components/public/locale-switcher.tsx`, `components/public/verification-confirmation.tsx`, `components/public/number-receipt.tsx`
- Create: `components/ui/confirmation-dialog.tsx`, `lib/i18n/messages.ts`
- Test: `tests/unit/raffle-form.test.tsx`, `e2e/public-journey.spec.ts`

- [ ] **Step 1: Write failing tests for linked policy and event-terms targets, then implement them.**

  Create `lib/campaign/legal.ts` with the official privacy URL and versioned bilingual Lucky Draw Terms content. Create `/[eventSlug]/terms`; require a valid event slug; link the form's `Privacy Policy` text to the official policy and `Terms` text to this event-specific route. Keep final legal wording in one versioned configuration module, not scattered UI strings.

- [ ] **Step 2: Write a failing form test for the required information hierarchy.**

  Assert optional profile fields appear before the section heading `Get your Lucky Draw number`, email and terms consent are required, and no street-address field exists.

- [ ] **Step 3: Implement the responsive form.**

  Render the cropped horizontal LIVAPON logo; default to English; provide a visible English/Japanese switch; persist locale and form draft in `sessionStorage`; clear draft after successful verification-request response. Country defaults to Canada and region is labeled `Province / State / Region`. Render the Cloudflare Turnstile widget, require its token before enabling the send action, and submit that token only to the registration endpoint. Unit-test it with a stubbed widget and use Cloudflare's non-production test key/secret only in local and staging environment variables; production refuses test keys.

- [ ] **Step 4: Write failing accessibility tests for `ConfirmationDialog`.**

  Assert focus starts on Cancel, Tab is trapped, Escape closes, and the action button names the irreversible action.

- [ ] **Step 5: Implement the reusable confirmation dialog.**

  Use it before verification-email send and resend. The send dialog visibly repeats the entered email address and offers Back/Cancel.

- [ ] **Step 6: Implement the verification page as a two-step action.**

  A GET of `/[eventSlug]/verify/[token]` only validates that the link can be used and renders `Confirm your email`. It must not mutate data. On the user-confirmed dialog action, call the confirmation Route Handler; then route to the permanent number page. This prevents email-security scanners from consuming links or issuing numbers.

- [ ] **Step 7: Implement the permanent number page.**

  Look up the receipt token only on the server; show the large number, screenshot-save prompt, and localized notice that winners are announced at the venue. Do not show profile editing or winner status.

- [ ] **Step 8: Add end-to-end coverage.**

  Test English and Japanese form submissions, session draft recovery after reload, confirmation dialog cancel/confirm, token confirmation, number receipt, no duplicate number, and expired token recovery.

- [ ] **Step 9: Run tests and commit.**

  ```bash
  pnpm test --run
  pnpm test:e2e
  git add app components lib tests e2e assets && git commit -m "feat: build public raffle experience"
  ```

## Task 7: Implement `@chairman.jp` operator access and administration

**Files:**
- Create: `app/auth/callback/route.ts`, `app/admin/login/page.tsx`, `app/admin/page.tsx`, `app/admin/entries/page.tsx`, `app/admin/entries/export/route.ts`, `app/admin/campaign/route.ts`
- Create: `components/admin/*`, `lib/security/admin.ts`
- Test: `tests/integration/admin-auth.test.ts`, `tests/integration/admin-export.test.ts`, `e2e/admin.spec.ts`

- [ ] **Step 1: Write failing authorization tests.**

  ```ts
  expect(isChairmanOperator('a.tanaka@chairman.jp')).toBe(true);
  expect(isChairmanOperator('person@example.com')).toBe(false);
  ```

- [ ] **Step 2: Implement domain-only operator authorization.**

  Normalize the email and require exact suffix `@chairman.jp`; reject empty local parts and lookalike domains. Validate both before requesting a Supabase magic link and after the callback session is created. On successful callback, write an `ADMIN_LOGIN` audit record with actor email, time, and campaign-independent scope.

- [ ] **Step 3: Implement the dashboard and entry list.**

  Display verified/pending counts, recent activity, current registration state, email/number search, and email-delivery failures. Query only server-side using a checked operator session.

- [ ] **Step 4: Implement CSV export.**

  Include the fields in `design.md`; use RFC 4180 escaping; emit a UTF-8 BOM for spreadsheet compatibility; write an `EXPORT_CSV` audit entry containing actor and campaign ID but not the exported data.

- [ ] **Step 5: Implement campaign pause/resume.**

  Require a confirmation dialog with Cancel as default. Write `PAUSE_REGISTRATION` / `RESUME_REGISTRATION` audit records. The public service must check this value on every write.

- [ ] **Step 6: Require confirmation dialog before CSV export and test Escape/focus behavior.**

- [ ] **Step 7: Run authorization, export, and browser tests; commit.**

  ```bash
  pnpm test --run tests/integration/admin-auth.test.ts tests/integration/admin-export.test.ts
  pnpm test:e2e -- admin.spec.ts
  git add app components lib tests e2e && git commit -m "feat: add raffle operator administration"
  ```

## Task 8: Configure production delivery and prove readiness

**Files:**
- Create: `README.md`, `docs/operations/prelaunch-checklist.md`, `docs/operations/on-site-runbook.md`
- Modify: `.env.example`
- Test: `e2e/production-smoke.spec.ts`

- [ ] **Step 1: Document Vercel environment variables and Supabase/Resend setup.**

  Include production domain `luckydraw.livapon.com`, Vercel domain setup, Supabase migration command, Turnstile hostname setup, and the required Resend SPF/DKIM verification for `info@chairman.jp`. Include final approval and insertion of the versioned bilingual Lucky Draw Terms text before public registration is enabled.

- [ ] **Step 2: Document event setup with no code change.**

  Specify how to set the `jfca-2026` opening time, Toronto draw start time, and derived close time; explain draft/open/paused/closed states. Do not add prize data to the application.

- [ ] **Step 3: Document the lost-number support procedure.**

  Direct requests to `info@chairman.jp`; have an operator search the database and respond within 2-3 days; do not add an automatic receipt resend feature.

- [ ] **Step 4: Add a load-test script and acceptance target.**

  Simulate at least 100 verification requests per second against staging without sending real email. Configure only staging with Cloudflare Turnstile test credentials and `MAIL_DELIVERY_MODE=log`; production startup rejects both settings. Confirm no duplicate numbers, no database connection failures, and a controlled response for rate-limited traffic.

- [ ] **Step 5: Run final automated checks.**

  ```bash
  pnpm lint
  pnpm typecheck
  pnpm test --run
  pnpm test:e2e
  ```

- [ ] **Step 6: Complete manual production checks before QR issuance.**

  1. Confirm DNS and TLS for `luckydraw.livapon.com`.
  2. Scan the exact production QR code on iOS and Android from a Toronto network or external Toronto probe.
  3. Verify English/Japanese flows, valid/expired/resend email, receipt link, operator login, pause/resume, CSV confirmation, and support contact.
  4. Confirm Vercel, Supabase, and Resend failure alerts reach the operator.

- [ ] **Step 7: Commit.**

  ```bash
  git add README.md docs .env.example e2e
  git commit -m "docs: add lucky draw release runbook"
  ```
