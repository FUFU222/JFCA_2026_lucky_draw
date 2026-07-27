# Lucky Draw handoff — updated 2026-07-27 (session 2)

## Repository and branch

- Repository root: `/Users/fufu/code/JFCA2026_lucky_draw`
- Active implementation worktree: `/Users/fufu/code/JFCA2026_lucky_draw/.worktrees/lucky-draw`
- Branch: `codex/lucky-draw`
- Do **not** work directly on `main`. `main` contains only the documented baseline.
- The working tree is clean. Tasks 1–4 are committed.

## Product decisions (authoritative)

The full service design is [design.md](/Users/fufu/Downloads/design.md). The implementation plan is [2026-07-27-lucky-draw.md](superpowers/plans/2026-07-27-lucky-draw.md).

- Public registration URL/QR target: `https://luckydraw.livapon.com/jfca-2026`.
- Initial campaign: `jfca-2026`, `Japan Festival Canada 2026`, Toronto (`America/Toronto`). Seeded as `DRAFT` with dates unset.
- Registration is open only in `SCHEDULED`, after `opens_at`, and before `draw_starts_at - 30 minutes`.
- One case-insensitive, trimmed email per campaign. Confirmation link expires in 24 hours; total sends are max 3 in 24 hours, with a 2-minute cooldown.
- Numbers are sequential/unbounded from 10000. A verification link must not issue a number on GET; the deliberate confirmation action is a POST.
- Receipt links have no expiry. The receipt email shows the participant's number but never winner/loser status.
- One required checkbox: `プライバシーポリシーおよび利用規約に同意する`; profile fields are optional and only country/region are collected (no street address).
- Public UI is bilingual English/Japanese, English default. Admin is restricted to exact `@chairman.jp` email domain.
- Transactional sender is `LIVAPON <info@chairman.jp>`; delivery domain setup is still a deployment task.

## Completed work

| Task | Status |
| --- | --- |
| 1. Next.js foundation, test/CI tooling | Complete |
| 2. Supabase schema, seed, RPCs | Complete — **now actually verified against Postgres** |
| 3. Numbers, tokens, validation, rate-limit abstraction | Complete |
| 4. Registration / resend / confirmation services and routes | Complete, reviewed, committed |

Commits added in session 2:

- `73339ad` `fix: make the raffle schema apply and reach the server role`
- `6ba6266` `feat: add verified raffle entry flow`
- `66ffd07` `fix: close the gaps an adversarial review found in the entry flow`

### What session 2 found in "reviewed" Task 2 work

Docker was unavailable when Task 2 was written, so `0001_lucky_draw.sql` had
**never been executed**. It could not be:

- `consume_raffle_rate_limit` declared a parameter named `limit`, a reserved SQL
  keyword. The migration aborted with SQLSTATE 42601. All arguments now carry a
  `p_` prefix, and the RPC callers were updated to match.
- Supabase no longer grants table DML to `service_role` by default, so the
  server could not read or write its own tables. The grant is now explicit.
- Vitest does not populate `process.env` from dotenv files, so the documented
  `.env.test.local` setup left the schema suite skipping forever.
  `tests/setup.ts` loads it now.

**Lesson worth keeping:** a skipped database suite reads exactly like a passing
one. `tests/supabase-env.ts` now throws in CI when credentials are absent, and
`.github/workflows/ci.yml` starts local Supabase so the migrations are applied
on every push.

## Task 4 as delivered

- `lib/raffle/service.ts` — `RaffleService` owns every decision and validates
  its own arguments with Zod (`lib/raffle/validation.ts`). Route handlers only
  reshape the request.
- `lib/db/server.ts` — `SupabaseRaffleRepository`, server-only, service-role.
- `supabase/migrations/0002_raffle_entry_flow.sql` — `claim_verification_send`,
  `claim_email_outbox_job_for_entry`, `complete_email_outbox_job`, and a
  replacement `confirm_raffle_verification(p_token_hash, p_receipt_token_hash,
  p_event_slug)`.
- Routes: `POST /api/campaigns/[eventSlug]/entries`, `.../entries/resend`,
  `.../verify/confirm`, plus `app/api/campaigns/_shared.ts` for the shared
  response mapping.

Properties that are enforced rather than assumed:

- The 2-minute cooldown and the 3-send ceiling are taken under a row lock, not
  read-then-incremented in the process.
- The receipt outbox lease uses `FOR UPDATE SKIP LOCKED`, and completion is
  fenced by the lease that claimed it.
- The event slug and campaign schedule are checked **inside** the confirmation
  transaction, so a link posted to the wrong event cannot consume a token or
  issue a number.
- `RD001` means the link is unusable and the visitor is told so; `RD002` means
  the receipt secret was rotated and is an operator fault that surfaces as a
  server error rather than a fake "invalid link".
- Addresses are matched with `eq`, never `ilike` — `_` and `%` in an address are
  pattern wildcards.
- Two concurrent first submissions both succeed; the unique index settles which
  row exists.

## Test suites

80 tests, all passing, plus one Playwright smoke test.

- `tests/unit/*` — numbers, tokens, validation, rate limiter, campaign config.
- `tests/integration/schema.test.ts` — tables, constraints, and every RPC,
  against real Postgres.
- `tests/integration/raffle-repository.test.ts` — the real Supabase adapter and
  the service end to end, against real Postgres. **This is the suite that would
  have caught the broken migration.** Keep it; do not replace it with fakes.
- `tests/integration/raffle-service.test.ts` — service decisions with an
  in-memory repository that mirrors the atomic steps the SQL actually provides.
- `tests/integration/raffle-routes.test.ts` — handler shaping and status mapping.

`vitest.config.ts` sets `fileParallelism: false`: the integration suites share
one database and the global outbox claim will lease another file's job.

## Known gaps, deliberately deferred

1. **The emailed links point at pages that do not exist yet.** `lib/email/resend.ts`
   builds `/{eventSlug}/verify/{token}` and `/{eventSlug}/number/{token}`; Task 6
   builds those pages. Do not send real mail before then.
2. **Nothing calls `claim_email_outbox_job()`.** A failed receipt sits in
   `FAILED` until Task 5 adds the cron worker.
3. **A verification send allowance is spent on the attempt, not on delivery.** A
   Resend outage can burn all three sends for a token. Task 5 should decide
   whether verification mail also goes through the outbox.
4. **`/entries/resend` with an expired token returns the generic 202 and sends
   nothing.** That matches the spec (a re-application issues a new link, a resend
   does not), but Task 6 must tell the visitor to submit the form again.
5. **The per-IP limit trusts `x-real-ip` / `x-forwarded-for`.** Confirm in Task 8
   that the deployment edge overwrites both; if it does not, the limit is
   bypassable.
6. **The Resend SDK call has no timeout.** Turnstile does (5s). Task 5 owns the
   mailer.
7. **Confirmation is refused once `draw_starts_at` passes or the campaign is
   `CLOSED`.** This is a decision made in session 2, not something design.md
   states. Confirm it with the operator; `PAUSED` deliberately does **not** block
   confirmation, because pausing is about intake.

## Remaining plan

5. React Email templates, Resend adapter completion, secure one-minute Vercel
   Cron outbox processor, staging `MAIL_DELIVERY_MODE=log`, production rejection
   of log mode.
6. Bilingual public registration/verification/receipt pages, session draft,
   Turnstile UI, required confirmation dialog, terms/privacy links, public E2E.
7. `@chairman.jp` Supabase magic-link administration, dashboard, search, CSV
   export/audit, pause/resume confirmation, admin E2E.
8. Vercel/Supabase/Resend/Turnstile operational docs, load test, Toronto QR/TLS
   manual checks, on-site runbook.

## Environment

Node 22 and pnpm 11.9 are pinned (`.nvmrc`, `package.json`). Session 2 ran on
Node 24 and everything passed, but engine warnings appear; use the pinned
version for final verification.

Docker is required for the database suites:

```bash
cd /Users/fufu/code/JFCA2026_lucky_draw/.worktrees/lucky-draw
open -a Docker
pnpm exec supabase start
pnpm exec supabase db reset
pnpm test
```

`.env.test.local` is gitignored and holds the local Supabase URL and keys that
`pnpm exec supabase status -o json` prints.

## Assets and legal inputs

- Cropped horizontal logo ready for mobile use: `assets/LIVAPON_logo_horizontal_cropped.png`.
- Original input: `assets/LIVAPON_logo_horizontal_350x.png`.
- Official privacy policy: `https://livapon.com/policies/privacy-policy`.
- Event-specific Lucky Draw Terms still need final legal wording before public
  launch. Keep them versioned in one configuration module when Task 6 lands.

## Recommended first commands for the next session

```bash
cd /Users/fufu/code/JFCA2026_lucky_draw/.worktrees/lucky-draw
git log --oneline --decorate -8
open -a Docker && pnpm exec supabase start && pnpm exec supabase db reset
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```
