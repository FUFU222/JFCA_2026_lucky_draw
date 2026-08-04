# Handoff — JFCA 2026 Lucky Draw

Updated 2026-08-04 (originally written 2026-07-29). Written for whoever picks
this up next, agent or human.

The application is built, deployed and operational at
`https://luckydraw.livapon.com`. What remains before the event is content and
configuration, not code — see [Open items](#open-items).

**[readiness-gaps.md](operations/readiness-gaps.md) is the living tracker of
what is still open, not this section.** It is dated and updated far more
often than this file is, and every unresolved item here already has an issue
number and a row in that document's Accepted Risks or Missing Mechanisms
tables. Read this file for how the system is built and why; read
readiness-gaps.md for what still needs doing.

Since this was last written: monitoring went from implemented-but-off to
fully wired (structured log, Slack alert webhook, three external monitors,
an hourly smoke workflow); a rollback was exercised for real; the freeze date
was set; the on-site outage plan, the data-retention/deletion policy and the
personal-data map were all written and decided; and a browser-side error
reporting layer was added — see
[monitoring.md](operations/monitoring.md#3-client-side-error-reporting) —
so a fault in a visitor's own browser, before any request even reaches the
server, is no longer invisible the way it was when this file was written.

## Repository

- Root: `/Users/fufu/code/JFCA2026_lucky_draw`
- Work happens in a git worktree under `.claude/worktrees/`, on a branch
  created for that session — never directly on `main`. See
  [runbook.md](operations/runbook.md#shipping-a-change) for the full
  pipeline: local checks, PR, code review, CI, merge, then
  `vercel --prod --yes` from a working tree whose content matches `main`.
  Delete the worktree and its branch once the work has shipped; a stray one
  left behind is what causes a later session to guess wrong about which is
  current.
- `main` is what deploys.

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
  Japan Festival Canada 2026, `America/Toronto`. **The event is Saturday
  15 August 2026** — a single day, which is why nothing here is built to run
  unattended.
- One case-insensitive address per campaign. Confirmation links expire in 24
  hours; at most 3 sends per token in 24 hours, 2 minutes apart.
- **Intake is opened and closed by hand.** `opens_at` and `draw_starts_at` are
  optional bounds and are both NULL in production, so `campaigns.status` alone
  decides. With no draw time there is no automatic cut-off: closing before the
  CSV is exported is what fixes the pool.

## Where things are

| Path | What lives there |
| --- | --- |
| `app/[eventSlug]/` | The visitor's five pages: form, verify, number, terms, lookup |
| `app/admin/` | Dashboard, entry search, CSV export, campaign controls, design preview |
| `app/api/campaigns/` | The four public writes (entry, resend, confirm, lookup) |
| `app/api/internal/email-outbox/` | Retry worker endpoint, called by GitHub Actions |
| `app/api/client-error/` | Public, rate-limited endpoint a visitor's browser reports its own JS errors to |
| `components/observability/` | The root-mounted listener that feeds the endpoint above |
| `lib/observability/` | Alert formatting, redaction, throttling and the `reportServerError()` every fault (server or client) goes through |
| `lib/raffle/service.ts` | The state machine. Every decision about who gets a number is here |
| `lib/db/server.ts` | The Supabase adapter, `server-only`, service-role |
| `lib/admin/` | Dashboard queries, audit log, CSV |
| `lib/security/` | Operator session, `@chairman.jp` check, Turnstile |
| `lib/config/startup.ts` | Boot-time configuration guard, via `instrumentation.ts` |
| `supabase/migrations/` | 0001–0010. The RPCs are where the concurrency safety lives |
| `emails/` | React Email templates, English only — verification only, since `0010` |

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
the GitHub Actions worker retries it. A send allowance is spent per message,
not per attempt, so a provider outage does not cost a visitor one of their
three sends.

That worker asks for a 5-minute schedule and does not get one — measured median
88 minutes, up to 197. It is a backstop rather than the delivery path, and the
visitor's own "Send it again" is the fast remedy; the manual `workflow_dispatch`
is the operator's. Do not write a five-minute figure back into any document.

**Issuing the number and showing it are two steps, and only the first is
safe.** The RPC is transactional; the hand-off to the receipt page is not. On
2026-07-30 a production confirm returned 200, issued 10000 and emailed the
receipt, and the Vercel logs show no request for the receipt page at all — the
client-side navigation produced nothing. These links are opened from mail
apps, so the page is usually inside an in-app browser. Two things came out of
it: the hand-off is now `window.location.assign`, which cannot silently do
nothing, and **a used verification link redirects to the number it issued**
rather than saying it cannot be used. The receipt token is derivable from the
verification token the visitor still holds, which is the same relationship the
RPC uses to answer a repeated confirmation, so re-opening the link finishes a
hand-off that failed. Do not turn either back into a soft navigation or a dead
end.

**Test mode is verified server-side, twice.** `?test=1` only does anything for a
signed-in operator, and `RaffleService` re-checks the operator session before
honouring the flag — a client claiming `is_test` on its own silently gets the
ordinary flow, captcha and all.

**The operator session needs three things**: an `@chairman.jp` address, a
confirmed email, and a prior `ADMIN_LOGIN` audit row. The third closes the
anon-key self-signup path, and it means the first sign-in for any account has to
go through the real magic-link flow.

**Confirmation dialogs are not applied uniformly, on purpose.** The entry form
has one because it shows the typed address back, and a typo there is a real,
common mistake with no other guard. The admin controls have them because
pausing or closing changes what every visitor sees. Closing is undoable —
受付を再開 appears on the closed screen — but the dialog is what keeps it
deliberate, and the reopen is written to the audit log.

Reopening earns its own warning, and the reason is worth keeping. Closing was
made undoable on the strength of `draw_starts_at`: a number could not be issued
once the draw had begun, whatever the status said. The next change made the
schedule optional and this event runs with no draw time at all, so that
backstop is not there. `campaigns.status` is now the entire gate, which is why
the reopen dialog says plainly what it does and why it is not the primary
button on the closed screen. The verify page deliberately has none: it exists to do one thing, is
reached by opening a link on purpose, states the consequence above the button,
and the "irreversible" outcome is precisely the one the visitor came for — a
dialog there only restated the page and put a tap between the visitor and their
number. Do not add one back for consistency.

**"Find my number" (`/{eventSlug}/lookup`) discloses a real, issued number to
whoever holds the address, no proof beyond that.** An accepted risk, decided
2026-07-31, not an oversight: the alternative was emailing the number back
instead of showing it, which the team chose against to avoid a second message
per lookup, having weighed that pickup is by screen at the venue regardless —
so the lookup does not change who can walk up with a number already in hand,
only how they got it onto a screen. Two rate limits are the whole backstop
(`RAFFLE_LOOKUP_EMAIL_REQUEST_LIMIT`, default 5/day per address;
`RAFFLE_LOOKUP_IP_REQUEST_LIMIT`, default 1000/day, sized like the entry
form's for the same venue-NAT reason), in their own bucket so a burst of
lookups can never spend the allowance a real entrant needs to submit or
resend, and the reverse. `RaffleService.lookupNumber` never checks
`isRegistrationOpen` — deliberately, since a visitor is most likely to need
this right around the draw, after intake has closed. The one thing it still
will not disclose is the difference between "no such address" and "entered
but not confirmed yet" — both answer identically, so a lookup cannot be used
to learn who has entered but not verified.

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
  the whole journey, including a new verification email. `resetTestEntry` clears
  the entry's `email_outbox` rows as part of this. That was load-bearing when a
  receipt was sent — without it the receipt job stayed at `SENT` and every
  rehearsal after the first issued a number on screen while silently sending
  nothing. Since `0010` there is no receipt to lose, but the clear stays: it is
  what keeps a rehearsal a clean run rather than one carrying the last one's
  bookkeeping.
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

`pnpm test` is 289 cases across 30 files as of 2026-08-04 (up from 260/27 on
2026-07-29 — expect this number to keep moving; run it rather than trust it).
`pnpm test:e2e` is 22 Playwright specs: 6 public journey, 7 admin, and 9
read-only production smoke that only run when `SMOKE_BASE_URL` is set — so a
local run reports 13.

## Open items

1. **`terms_version` must never be edited in place once real entries exist.**
   Settled 2026-07-29 at `jfca-2026-terms-v1`, with the marketing consent split
   into its own optional checkbox and the wording finalised — see the commits
   from that date. What remains is a rule rather than a task.

   A stored consent points at the wording that was on screen when it was given.
   Editing the campaign row's `terms_version` afterwards relabels consents that
   were collected against different text — it claims people agreed to something
   they never saw, which is worse than having no version at all. Changed
   wording means a new version, applied to a campaign with no entries or to the
   next event.

   The constant in `lib/campaign/legal.ts` describes the wording *in that file*
   and is not what gets stored; the campaign row is. Nothing keeps them
   agreeing, so the admin dashboard compares the two and flags a drift rather
   than letting it be discovered from a consent record nobody can reproduce.
Everything else that was tracked here as of 2026-07-29 has since moved to
[readiness-gaps.md](operations/readiness-gaps.md), each with its own GitHub
issue (`gh issue list --state all`) carrying the reasoning for why it is
still open or was accepted rather than fixed. As of 2026-08-04: the resend
after link expiry (was item 2 here) is fixed and closed
([#5](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/5)); the per-IP
header trust (was item 3) was reviewed and closed
([#3](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/3)); the
Resend-timeout race, the submit race, the consent-overwrite race, and E2E not
running in CI (were items 4, 7, 8, and 5) are all still open — see
readiness-gaps.md's Accepted Risks table and its P5 entry for the current
reasoning on each, rather than trusting the summary that used to be here.
Staging not being a Vercel deployment (was item 6) is not a gap at all, just
a fact of how the platform works — see [staging.md](operations/staging.md).

Resolved since: the visitor's form used to lead with seven expanded optional
fields, putting the only required one 935px down an 812px viewport. The section
is now a collapsed disclosure — still first, so the offer is made before the
visitor commits, but the whole form now fits on one phone screen with no
scrolling. It auto-expands when a restored draft has anything in it.

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
open -a Docker && pnpm exec supabase start && pnpm exec supabase db reset
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

`.env.local` and `.env.test.local` are gitignored; the local Supabase values
come from `pnpm exec supabase status -o json`. Local mail lands in Mailpit at
`http://127.0.0.1:54324`.

## Assets and legal inputs

- Logo in use: `assets/LIVAPON_logo_horizontal_cropped.png`
  (original: `assets/LIVAPON_logo_horizontal_350x.png`).
- Privacy policy: `https://livapon.com/policies/privacy-policy`.
- Lucky Draw Terms live in `lib/campaign/legal.ts`; wording and version were
  finalized 2026-07-29 at `jfca-2026-terms-v1` and must not be edited in
  place now that real entries exist — see [Open items](#open-items) above.

## The operational documents

- [readiness-gaps.md](operations/readiness-gaps.md) — the living tracker of
  what is still open or was deliberately accepted, with a deadline and an
  owner against each item. Start here.
- [runbook.md](operations/runbook.md) — the engineering side: shipping a
  change, rolling one back, rotating a secret, and what to do when an alert
  fires. For the maintainer, not the booth operator.
- [prelaunch-checklist.md](operations/prelaunch-checklist.md) — everything that
  must be true before the QR code is printed.
- [on-site-runbook.md](operations/on-site-runbook.md) — what the operator does
  at the venue. Names every control exactly as it appears on screen.
- [monitoring.md](operations/monitoring.md) — the error log, the alert
  webhook, client-side error reporting, and the external monitor.
- [backup-restore.md](operations/backup-restore.md) — the Supabase plan's
  backup capability (none, on Free), the manual dump procedure, and the
  restore that was actually run to prove it works.
- [data-privacy.md](operations/data-privacy.md) — retention, the deletion
  procedure, the personal-data map, and who holds which credential.
- [staging.md](operations/staging.md) — the load test, and why staging is not a
  Vercel deployment.
- [qa-verification-checklist.md](operations/qa-verification-checklist.md) —
  what to run in test mode on production to close the gap a local-only QA
  pass cannot reach (the admin dashboard).

The original implementation plan,
[superpowers/plans/2026-07-27-lucky-draw.md](superpowers/plans/2026-07-27-lucky-draw.md),
is a historical record: it was executed and then superseded by test mode, the
English-only public side, the Japanese admin side, one-tap campaign controls and
the GitHub Actions worker. Read it for intent, not for current behaviour.
