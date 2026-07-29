# Handoff — JFCA 2026 Lucky Draw

Updated 2026-07-29. Written for whoever picks this up next, agent or human.

The application is built, deployed and operational at
`https://luckydraw.livapon.com`. What remains before the event is content and
configuration, not code — see [Open items](#open-items).

## Repository

- Root: `/Users/fufu/code/JFCA2026_lucky_draw`
- Implementation worktree: `.worktrees/lucky-draw`, branch `codex/lucky-draw`
- `main` is what deploys. The worktree branch is fast-forwarded into it, pushed,
  then released with `vercel --prod --yes` from the repository root.

## What it does

A visitor scans a QR code, submits their email address (plus optional profile
fields), confirms through an emailed link, and is issued a permanent Lucky Draw
number starting at 10000. The number page URL is a bearer token and never
expires. Results are announced at the venue; the application holds no prize data
and never says who won.

- **Visitor pages are English only.** The Japanese copy and the language
  switcher were removed; migration `0007_english_only.sql` constrains
  `raffle_entries.locale` to `'en'`. The column stays because the CSV export
  still carries it.
- **Admin pages are Japanese only**, at `/admin`, restricted to `@chairman.jp`
  by Supabase magic link.
- QR target: `https://luckydraw.livapon.com/jfca-2026`. Campaign `jfca-2026`,
  Japan Festival Canada 2026, `America/Toronto`.
- One case-insensitive address per campaign. Confirmation links expire in 24
  hours; at most 3 sends per token in 24 hours, 2 minutes apart. Registration is
  open only while `SCHEDULED`, after `opens_at`, and before
  `draw_starts_at - 30 minutes`.

## Where things are

| Path | What lives there |
| --- | --- |
| `app/[eventSlug]/` | The visitor's four pages: form, verify, number, terms |
| `app/admin/` | Dashboard, entry search, CSV export, campaign controls, design preview |
| `app/api/campaigns/` | The three public writes (entry, resend, confirm) |
| `app/api/internal/email-outbox/` | Retry worker endpoint, called by GitHub Actions |
| `lib/raffle/service.ts` | The state machine. Every decision about who gets a number is here |
| `lib/db/server.ts` | The Supabase adapter, `server-only`, service-role |
| `lib/admin/` | Dashboard queries, audit log, CSV |
| `lib/security/` | Operator session, `@chairman.jp` check, Turnstile |
| `lib/config/startup.ts` | Boot-time configuration guard, via `instrumentation.ts` |
| `supabase/migrations/` | 0001–0007. The RPCs are where the concurrency safety lives |
| `emails/` | React Email templates, English only |

## The parts that are easy to get wrong

**Numbers are issued inside `confirm_raffle_verification`**, not in application
code. It locks the campaign row, reads the counter, increments it, and writes
the entry in one transaction, so two simultaneous confirmations of the same link
return the same number rather than two. Do not move this into TypeScript.

**Tokens are never stored.** A verification link is
`HMAC(VERIFICATION_TOKEN_SECRET, "verification:" + token_row_id)`; a receipt link
is `HMAC(RECEIPT_TOKEN_SECRET, verification_token)`. Only SHA-256 hashes go in
the database. This is what lets a resend reproduce the same link without the
plaintext ever being written down. Rotating `RECEIPT_TOKEN_SECRET` after launch
breaks every receipt link already sitting in a visitor's inbox.

**Mail is inline first, durable second.** The visitor at the booth gets their
link immediately; if Resend refuses, the message is armed in `email_outbox` and
the GitHub Actions worker retries every 5 minutes. A send allowance is spent per
message, not per attempt, so a provider outage does not cost a visitor one of
their three sends.

**Test mode is verified server-side, twice.** `?test=1` only does anything for a
signed-in operator, and `RaffleService` re-checks the operator session before
honouring the flag — a client claiming `is_test` on its own silently gets the
ordinary flow, captcha and all.

**The operator session needs three things**: an `@chairman.jp` address, a
confirmed email, and a prior `ADMIN_LOGIN` audit row. The third closes the
anon-key self-signup path, and it means the first sign-in for any account has to
go through the real magic-link flow.

## Test mode, in full

Added because rehearsing the journey previously meant creating real entries.

- Entered by following **テストモードで開く** on the dashboard, i.e.
  `/{eventSlug}?test=1` with an operator session.
- Numbers come from `campaigns.test_next_number`, starting at 900000001, so they
  can never collide with a visitor's.
- Excluded from the dashboard counts, the 送信待ちメール数 gauge and the CSV
  export. Shown in 最近の応募 and 応募一覧 with a テスト badge.
- Skips the schedule, the rate limits and the captcha, so a rehearsal works
  before opening, after closing and while paused.
- **Resubmitting the same address resets the previous rehearsal** and re-runs
  the whole journey, including a new verification email and a new receipt email.
  `resetTestEntry` clears the entry's `email_outbox` rows as part of this —
  without that the receipt job stays at `SENT` and every rehearsal after the
  first issues a number on screen while silently sending no receipt.
- **A rehearsal on an address a real entry holds is refused**
  (`test_address_conflict`, HTTP 409), because overwriting that row would move a
  genuine entrant into the test number range and drop them from the draw. The
  reverse is allowed: a real submission takes an address back from a rehearsal.

## Verification status

On 2026-07-29 every public and admin route was walked by hand against a local
database, in a mobile viewport for the visitor's pages. Confirmed working: all
five schedule states, with the page and the API agreeing in each; consumed,
malformed and unknown tokens; the 30-minute pre-draw cut-off; the per-address
rate limit and the per-token send cooldown; non-disclosing responses on resend;
every admin route refusing an unauthenticated caller; all four campaign actions
with their audit rows; search, CSV export and the preview page.

Five defects were found and fixed in `cf1c1d6` — that commit message describes
each one and why it mattered.

`pnpm test` is 186 cases across 23 files. `pnpm test:e2e` is 19 Playwright
specs: 5 public journey, 6 admin, 8 read-only production smoke.

## Open items

1. **The Lucky Draw terms still need legal sign-off.** `lib/campaign/legal.ts`
   carries placeholder wording under `jfca-2026-terms-v1-placeholder`, and the
   production campaign row still has that version. When the final text lands,
   bump the constant and the campaign's `terms_version` in the same change, so a
   recorded consent always points at the text that was shown.
2. **A resend after the link expired sends nothing** and the acknowledgement
   page does not say "submit the form again". The service behaviour is
   intentional; the wording gap is real. The *verify* page was fixed; only the
   resend acknowledgement is still silent.
3. **The per-IP limit trusts `x-real-ip` / `x-forwarded-for`.** Confirm Vercel
   overwrites both on ingress; if it does not, the limit is bypassable.
4. **The Resend send is raced against a 10-second timeout, not cancelled.** A
   request that wins after the timeout may already have delivered, so a retry
   can duplicate a message. Duplicates are preferred to losses.
5. **E2E does not run in CI.** `.github/workflows/ci.yml` runs `pnpm test` only,
   because the browser suite needs a Supabase stack and a Turnstile test key.
6. **Staging cannot be a Vercel deployment** as previously documented — every
   Vercel build is `NODE_ENV=production`, which the startup guard and the
   Turnstile check both key on. See `docs/operations/staging.md`; test mode now
   covers most of what staging was for.
7. **A submit race can leave two live verification links for one entry.** Narrow
   window, and the issued number stays correct, but the second link then returns
   a 500 for its full 24-hour lifetime instead of "link cannot be used". Not
   fixed: the fix is in SQL, and the race needs two requests for a brand-new
   address to interleave within milliseconds.
8. **Profile fields on an unverified entry can be overwritten** by anyone
   resubmitting that address. Bounded by the 5/day per-address limit, cannot
   yield a number, and is inherent to an email-keyed form that stores the
   profile before verification.
9. **The visitor's form leads with the optional profile section**, so the only
   required field is more than a screen down on a phone. Whether to reorder it
   is a product tradeoff — entry completion against profile data volume — and
   has not been decided.

## Things that surprised previous sessions

- `limit` is a reserved word in PL/pgSQL, hence the `p_`-prefixed arguments on
  `consume_raffle_rate_limit`.
- Supabase's `db push` prints a catalog-cache warning that looks like a failure
  and is not; `migration list` confirms the real state.
- A trailing newline on a pasted Vercel environment variable took production
  down once. `parseMailDeliveryMode` now trims.
- `playwright.config.ts` sets `reuseExistingServer: false` on port 3001, so a
  stray `next dev` there fails the whole suite.
- The admin magic link must be requested from the login form, not the Auth API
  directly: the form's browser client sets the PKCE verifier cookie that
  `/auth/callback` needs, and a link requested any other way comes back as an
  implicit-flow token the callback deliberately refuses.
- Supabase Auth sends the operator sign-in mail itself, not Resend. Its
  project-wide limit was raised from 2 to 30 per hour; the 60-second
  per-address cooldown is not configurable.

## Environment

Node 22 and pnpm 11.9 are pinned (`.nvmrc`, `package.json`); newer Node works
but prints engine warnings. Docker is required for the database suites.

```bash
cd /Users/fufu/code/JFCA2026_lucky_draw/.worktrees/lucky-draw
open -a Docker && pnpm exec supabase start && pnpm exec supabase db reset
pnpm test && pnpm typecheck && pnpm lint
```

`.env.local` and `.env.test.local` are gitignored; the local Supabase values
come from `pnpm exec supabase status -o json`. Local mail lands in Mailpit at
`http://127.0.0.1:54324`.

## Assets and legal inputs

- Logo in use: `assets/LIVAPON_logo_horizontal_cropped.png`
  (original: `assets/LIVAPON_logo_horizontal_350x.png`).
- Privacy policy: `https://livapon.com/policies/privacy-policy`.
- Lucky Draw Terms live in `lib/campaign/legal.ts` and still need final wording.

## The operational documents

- [prelaunch-checklist.md](operations/prelaunch-checklist.md) — everything that
  must be true before the QR code is printed.
- [on-site-runbook.md](operations/on-site-runbook.md) — what the operator does
  at the venue. Names every control exactly as it appears on screen.
- [staging.md](operations/staging.md) — the load test, and why staging is not a
  Vercel deployment.

The original implementation plan,
[superpowers/plans/2026-07-27-lucky-draw.md](superpowers/plans/2026-07-27-lucky-draw.md),
is a historical record: it was executed and then superseded by test mode, the
English-only public side, the Japanese admin side, one-tap campaign controls and
the GitHub Actions worker. Read it for intent, not for current behaviour.
