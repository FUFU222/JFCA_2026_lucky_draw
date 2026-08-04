# Readiness gaps

What is still unverified or missing, in one place, with a deadline against each
item. Written 2026-07-30.

The other operational documents describe **what to do**. This one records **what
has not been done**, which is a different thing and is the part that goes wrong
when nobody is holding a list. Two of the entries below are not tasks at all —
they are decisions to accept a known defect, recorded so they cannot later be
discovered by surprise.

## How to read this

- **D is 2026-08-15**, with intake closing at **18:00 Toronto** (22:00 UTC).
  Confirmed 2026-07-30, which is D-16. Every deadline below is relative to it.

  The schedule is still run by hand — `opens_at` and `draw_starts_at` stay
  unset, and 受付を終了 at 18:00 is what ends the pool. The date being written
  down here does not put it in the database; see
  [prelaunch-checklist.md](prelaunch-checklist.md) §6.

- **Severity.** S1 stops the event or loses data. S2 degrades the visitor's
  experience or the operator's ability to run it. S3 matters afterwards, or the
  next time this code is used.
- **Owner.** Every row is the same person, which is itself the highest-standing
  process risk here — see [P4](#p4-one-person-holds-every-credential). "Operator"
  below means whoever is at the booth; everything else is the maintainer.

Nothing in this document duplicates [prelaunch-checklist.md](prelaunch-checklist.md).
That file is the gate before the QR code is printed and remains the authority on
its own items; this one covers what that gate does not ask about.

## Blockers — must be true before the QR code is printed

### B1. The Resend API rate limit is still the default (S2, by D-7)

The plan is settled: Pro was taken on 2026-07-29, the quota is soft, and going
over it costs cents rather than stopping the event. That work is done and
[prelaunch-checklist.md](prelaunch-checklist.md) §2 now describes it correctly.

**The rate limit is the part that is not done, and it is the opposite kind of
problem.** Confirmed from Settings → Usage on 2026-07-30: team `chairman`, Pro,
**rate limit 10 req/s**, monthly 27 / 50,000 renewing Aug 28, daily limit
unlimited. It cannot be changed from the dashboard and needs a human at Resend
support to raise. Both messages are sent inline as visitors arrive: a seven-hour
day at 30,000 entrants averages ~2.4/s, and festival arrivals cluster three to
four times over, which puts the booth at the ceiling exactly when a queue is
forming. A 429 is not handled specially anywhere — the message falls to
`email_outbox` and waits for a worker whose real interval is about 88 minutes,
and the visitor's own **Send it again** hits the same ceiling.

Downgraded from S1 on 2026-07-30, and the reason has since shipped: `0010`
removed the receipt email, which halves the volume and takes the peak to
3.6–4.8/s — inside the current limit, with about twice the headroom. See
[the plan](../superpowers/plans/2026-07-30-receipt-email-removal.md). The
request below is now insurance rather than a blocker. **Send it either way**:
it costs nothing and the turnaround is somebody else's. The one remaining
message is also the more critical of the two, since a 429 on it stops the
journey rather than delaying a copy.

The figures above describe the two-email world and are left as written, because
the plan and the ceiling they measure against have not changed. Against 30,000
messages the allowance is now comfortable rather than exceeded.

- [ ] Ask Resend support for 50/s. **Send the request on the earliest possible
      day**; it is the one item here with a third party's response time in it.
- [ ] Confirm a valid card is on file. A declined card turns the soft quota into
      a hard stop, which is the only way volume can end the event.
- [ ] **Confirm transactional pay-as-you-go is switched on.** With the receipt
      email, 60,000 messages against a 50,000 allowance means the last ~10,000
      are overage — about $9 at $0.90 per 1,000. Off, sending stops dead at
      50,000 mid-event. The Settings → Usage screen shows the toggle beside
      Automations, so the transactional one has to be found and read
      deliberately rather than assumed.
- [ ] **Set a daily limit of 60,000–80,000** (Settings → Usage → Daily limit,
      currently unlimited). This is the better protection than leaving
      pay-as-you-go off: it bounds a runaway loop to tens of dollars while
      leaving roughly twice the headroom a real event day needs. Turning
      pay-as-you-go off to cap the cost instead trades a bounded $180 — the
      hard cap is five times the plan quota — against the event stopping at the
      booth, which is the wrong way round.

### B2. The Supabase plan is not recorded (S1, by D-7) — closed 2026-07-31

Confirmed via the Supabase Management API: organization **`FUFU222's Org`**,
plan **Free**. On Free there is no automatic backup of any kind (daily
backups and PITR are both Pro-and-above features), backups cannot be
downloaded even if one existed, and the project pauses after 7 days of low
activity — a real risk for a project created 2026-07-28 with no scheduled
traffic hitting it daily. Full detail in
[backup-restore.md](backup-restore.md).

**Decision (2026-07-31, project owner): stay on Free.** The mitigation is a
manual dump, run reliably rather than automatically, rather than paying for
Pro's automatic one. See B3.

- [x] Write the plan and its backup capability into this file.
- [x] Decide whether to move off Free — decided not to; manual dump instead.

### B3. Backups have never been restored (S1, by D-7) — closed 2026-07-31

There was no backup or restore procedure anywhere in the repository. The
entrant table is the draw itself and cannot be re-collected — and it already
holds 5 real, verified rows from the maintainer's own dry-run entries, so this
was not a theoretical gap even before the event.

Full write-up, commands, and the restore proof in
[backup-restore.md](backup-restore.md). Summary:

- [x] **RPO/RTO recorded, pending final owner sign-off**: RPO effectively
      zero for the pool (the CSV export at intake-close is the real
      backstop), RTO under one hour (the restore below took minutes).
- [x] **Restored once and confirmed row counts.** `supabase db dump --linked`
      (no database password needed) into the local Supabase dev stack, used
      as the scratch target because the organization is already at its
      2-project Free-tier cap. All 7 tables matched production exactly. The
      file with real addresses in it was deleted immediately after.
- [ ] Export a CSV to a second location the moment intake closes, before
      anything else. Added as on-site-runbook.md step 6a; still needs
      **someone to actually do it reliably on the day** — a personal
      calendar/phone reminder is the recommendation, not a piece of
      automation (a scheduled cloud agent was considered and rejected: an
      unattended agent with production access is a worse risk than the one
      it would solve).

### B4. The load test has never been run (S2, by D-5)

The 100 requests/second target in [staging.md](staging.md) is unmeasured, and the
environment it needs does not exist: every Vercel build is `NODE_ENV=production`,
which the startup guard and the Turnstile check both key on, so the load test
needs the built app running somewhere else against a separate Supabase project.

- [ ] Stand that up and run it, or **record the decision not to** and say what is
      being accepted instead. Either is defensible; leaving the target in a
      document while never measuring it is not.

### B5. Monitoring is implemented but switched off (S2, by D-3) — closed 2026-07-31

Landed on this branch: a structured error log, an alert webhook, `/api/health`,
and an hourly `Production smoke` workflow. Three of the four layers did nothing
until configured; all four are now live.

- [x] Slack incoming webhook created (`#jfca-luckydraw-alerts`), `ALERT_WEBHOOK_URL`
      set in Vercel Production and redeployed.
- [x] Three UptimeRobot monitors created: down-alert and degraded-state
      always on, `"accepting":true` created and correctly left **paused**
      until intake opens.
- [x] **`detail.errorAlerts` confirmed `"on"` against production** — but only
      after an unplanned detour: the original `CRON_SECRET` turned out to be
      unrecoverable. It was saved as a Vercel **Sensitive** environment
      variable, which cannot be read back by anyone, through any interface,
      once saved — not a permissions gap, a platform guarantee. Rotated
      instead: new value set in Vercel and as the matching GitHub Actions
      repository secret, production redeployed, confirmed `"on"`, and the
      email outbox retry worker's `workflow_dispatch` run manually re-checked
      to prove it still authenticates with the new value (`gh run view` ✓).
      **Lesson for next time:** a Sensitive-typed secret needs its value kept
      somewhere retrievable (password manager) the moment it is created, or
      losing the local `.env.local` copy means losing it entirely.
- [x] The event-day `"accepting":true` monitor's start/stop is on the
      operator's checklist in [on-site-runbook.md](on-site-runbook.md).
- [ ] The alerting items in [prelaunch-checklist.md](prelaunch-checklist.md) §9
      (Vercel, Supabase and Resend's own native notifications) are separate
      from all of the above and still unchecked.

### B6. There is no rollback procedure and no code freeze (S2, by D-3) — closed 2026-08-03

Vercel can roll a deployment back instantly. Nothing said so, and there was no
date after which changes stop.

- [x] **Freeze date confirmed (project owner, 2026-07-31): D-2, 2026-08-13.**
      After that date nothing ships except a fix for something the dry run
      found.
- [x] **Rolled back a deployment on purpose before, confirmed by the project
      owner (2026-08-03).** A fresh in-session rehearsal was attempted twice
      and deferred both times — see below — but the owner has already done
      this for real previously, which is what this item actually exists to
      establish confidence in. Two things learned from the attempts, worth
      keeping regardless:
      - The project is on Vercel's **Hobby** plan, which only allows a
        rollback to the *immediately preceding* production deployment —
        `vercel rollback <two-or-more-back>` fails with `402 upgrade to
        pro`. One-step rollback is what this event needs anyway (see B6a
        below), but it means "roll back to before yesterday's three
        deploys" is not available; a fix has to go forward as a new deploy
        instead.
      - `vercel rollback <url> --yes` is the command, run from the repo
        root, and needs no dashboard step. `vercel rollback` with no
        argument reports whether one is in progress.

#### B6a. Why one-step rollback is enough here

Vercel's `isRollbackCandidate` flag (visible via `list_deployments`) is only
`true` for the current production deployment and the one immediately before
it — never for anything older. Combined with the Hobby-plan limit above,
**the rollback tool only ever reaches back one deploy**, which is exactly
why the freeze date matters: after D-2, at most one deploy (an emergency fix)
should happen before the event, so "roll back" always means "back to the
last known-good state," never "which of the last five deploys was it."

### B7. There is no plan for the venue when the system is unavailable (S1, by D-2) — closed 2026-07-31

The rate limiter fails closed, so a Supabase outage shows every visitor "Too
many attempts" rather than an outage message. The runbook covers what to check;
it did not cover what the booth *does* for the twenty minutes it lasts. Now
written up as its own section in
[on-site-runbook.md](on-site-runbook.md#the-system-is-down-not-just-the-venue-network).

- [x] **Decision (project owner, 2026-07-31): no paper fallback.** Staff tell
      visitors entry is temporarily down and to try again shortly; nothing is
      collected on paper, so the consent-wording question this would have
      needed does not arise. Accepted as a real cost — a visitor who leaves
      during the outage window is lost — in exchange for not building a second,
      lower-fidelity intake path two weeks before the event.
- [x] **Decision (project owner, 2026-07-31): the on-site operator decides,
      on the spot.** No phone call, no waiting on the maintainer. Whoever is
      running the booth judges whether to hold visitors a few minutes or wave
      them on, and checks `/api/health` to know when it is over.

## Missing mechanisms

### P1. No retention period, no deletion path (S2, by D-1 for the wording; the process can follow) — closed 2026-07-31

The system collects email addresses, optional profile fields including date of
birth, and marketing consent. Nothing stated how long any of it was kept, and
there was no procedure for "delete my entry" — an ordinary request under
PIPEDA, and the event is in Toronto. Full write-up, SQL and process in
[data-privacy.md](data-privacy.md).

- [x] **Retention (project owner, 2026-07-31): 90 days after the event,
      2026-11-13.**
- [x] Deletion procedure written, with SQL. Turned out simpler than
      expected: `verification_tokens`, `email_outbox` and `email_deliveries`
      all declare `on delete cascade` from `entry_id`, so only
      `raffle_entries` itself needs handling by hand.
- [x] `info@chairman.jp` requests are answered by the maintainer, within a
      few business days — same as every other support path in
      [on-site-runbook.md](on-site-runbook.md).
- [x] **Decision (project owner, 2026-07-31): a pre-draw deletion request
      does not remove the entry from the pool.** The row (and number, once
      issued) is kept; the personal fields are anonymized in place. An
      unverified request is deleted outright since no number was issued.
      Not yet reflected in the public terms wording — see the note below.

**Open follow-up, not urgent:** [lib/campaign/legal.ts](../../lib/campaign/legal.ts)
does not currently state a retention period or describe the anonymize-not-remove
behavior; it defers to the external LIVAPON Privacy Policy. Whether to add it
here is a wording change under the live `jfca-2026-terms-v1` version, which
[prelaunch-checklist.md](prelaunch-checklist.md) §5 says never to edit once
real entries exist (five already do, from the maintainer's own dry run) —
a new version would be needed if this is wanted before the event.

### P2. The unsubscribe promise has no implementation and no owner (S2, before any marketing mail is sent)

[lib/i18n/messages.ts](../../lib/i18n/messages.ts) tells the visitor "You can
unsubscribe at any time", and the terms say every message includes a way to stop
receiving them. **Nothing in this repository sends marketing mail or offers an
unsubscribe link**, which is correct — but it means the promise is owned by a
system that has not been chosen yet, and CASL requires it of whoever sends.

Resend is the obvious candidate and **cannot take the list as things stand**:
its Marketing side on this team is on the Free tier, capped at 1,000 contacts
(Settings → Usage, read 2026-07-30). A consented list from a 30,000-entrant
event does not fit. That is not a blocker for the event — nothing is sent during
it — but it means the receiving system is not merely unnamed, it is unbudgeted.

- [ ] Name the platform the consented list goes to, and confirm it puts an
      unsubscribe link in every message.
- [ ] Write down how the export reaches it, and who does that.
- [x] **Decision (project owner, 2026-07-31): do not send anything to that
      list until both are answered.** The platform itself stays undecided —
      deliberately deferred to after the event rather than rushed now.

### P3. Personal data has no map (S3, by D-1) — closed 2026-07-31

Written as the table in [data-privacy.md](data-privacy.md#the-personal-data-map):
what is collected, where it lives, who can reach it, and what leaves the
system (the CSV export, the alert webhook after redaction — the receipt email
was removed in `0010`).

### P4. One person holds every credential (S2, by D-3) — closed 2026-07-31

Vercel, Supabase, Resend, GitHub, Cloudflare and DNS are all held by one account.
The runbook already says to sign in on a second device before doors open, which
addresses being locked out of the admin screens and nothing else. Full access
list in [data-privacy.md](data-privacy.md#access-who-holds-which-credential).

- [x] Access list written: which service, which account, where the credential
      is kept.
- [x] **Decision (project owner, 2026-07-31): nobody else gets standing
      access.** A second credential holder was judged a bigger new risk for a
      one-day event than the one it would solve. If the maintainer is
      unreachable, the booth runs on what B7 already decided, not on new
      access granted on the spot.
- [x] Secrets that would need rotating if this is revisited, and the one that
      cannot be rotated at all (`RECEIPT_TOKEN_SECRET`), listed in
      data-privacy.md.

### P5. The browser suite still does not run in CI (S3, after the event)

`ci.yml` runs lint, typecheck, the unit and integration suites and a production
build. The Playwright suites need a Supabase stack and a Turnstile test key and
are therefore manual — so the only automated check of the actual journey is the
read-only smoke suite against a deployed origin.

Not worth changing before the event. Worth doing before this code is reused.

### P6. `/api/health`'s caching only holds within one warm instance (S3, worth a look if traffic to it looks odd)

Found in review, 2026-07-30. The endpoint is public and unauthenticated on
purpose — see [monitoring.md](monitoring.md) — and its ten-second snapshot
cache is a plain module-level variable. That only protects one warm process.
Vercel runs several concurrently, so a burst of requests — an aggressively
configured monitor, or anyone who finds the URL and loops `curl` against it —
lands on multiple instances at once, each with its own empty cache, each
issuing its own read against the same database the numbering RPC depends on
for correctness under concurrency.

In practice the two queries behind it are indexed lookups (`campaigns` by
`slug`, a counted `email_outbox` join), not table scans, and a single
reasonably-configured external monitor is nowhere near enough to matter. Not
fixed now: a real fix means a shared limiter — edge middleware or a KV-backed
token bucket — which is new infrastructure to introduce and verify two weeks
out. Revisit if traffic to `/api/health` ever looks like more than one caller,
or before this pattern is reused somewhere with less headroom.

## Accepted risks

Recorded rather than fixed. Each one is a decision, and the reason is the part
worth keeping.

| # | Issue | Risk | Why it is accepted |
| --- | --- | --- | --- |
| R1 | [#1](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/1) | An unverified entry's marketing consent can be overwritten by anyone resubmitting that address, leaving a consent timestamp that is evidence of nothing | Before verification nobody owns the row, and the person confirming cannot be told apart from the person who ticked the box. The real fix issues a fresh token whenever consent changes. Bounded by the 5/day per-address limit and it cannot yield a number. Fix before this code mails a list |
| R2 | [#2](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/2) | A submit race can leave two live verification links for one entry; the second returns a 500 for 24 hours instead of "link cannot be used" | The issued number stays correct. The fix is in SQL and the race needs two requests for a brand-new address to interleave within milliseconds |
| R3 | [#3](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/3) — closed | The per-IP limit trusts `x-real-ip` / `x-forwarded-for` | Tried to confirm empirically on 2026-07-31 and stopped: the only way to see what the deployed function actually resolves is an authenticated call to `/api/health`, and `CRON_SECRET` is a Vercel "Sensitive" variable — unreadable from the dashboard, from `vercel env pull`, from anywhere, once set. Verifying it would have meant rotating a secret two other systems (the outbox worker, the smoke workflow) already depend on, for a check whose downside is bounded even if it fails: a spoofed IP still has to clear Turnstile on every attempt and is still capped at 5/day per address, and `RAFFLE_IP_REQUEST_LIMIT` is already 100000 — a loose backstop for the venue's shared NAT, not a tight fraud control. Overwriting `x-forwarded-for` on ingress is standard reverse-proxy behaviour, not a Vercel-specific claim being taken on faith. Revisit only if a future change makes the per-IP limit load-bearing on its own |
| R4 | [#4](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/4) | A Resend send is raced against a 10-second timeout rather than cancelled, so a retry can duplicate a message | Duplicates are preferred to losses |

These came from [HANDOFF.md](../HANDOFF.md), which is where they were first
written down. They belong in an issue tracker rather than a prose document,
because prose does not survive the person who wrote it — so each now has an
issue, and the issue carries the reason it is accepted rather than only what it
is.

## Cleanups

- **C1. The CSV export can truncate silently
  ([#6](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/6), fixed —
  pending merge).** A trailing marker row plus a corrective
  `EXPORT_CSV_INCOMPLETE` audit entry, since the response is already 200 with
  the download headers sent before the first row streams. Neither the HTTP
  status nor the filename can change after the fact; the file itself and the
  audit trail are what's left to say so.
- **C5. A resend clicked inside its own cooldown silently spent one of the
  visitor's five daily attempts for nothing — fixed 2026-07-31.** Found during
  a QA simulation of the full visitor journey. `claim_verification_send`
  (supabase/migrations/0002) refuses a send inside its 2-minute cooldown or
  past 3 sends per token, but that refusal happens *after*
  `consumeRequestAllowance` had already spent one of the address's 5 daily
  attempts — so an anxious visitor who clicked **Send it again** a few
  seconds after the original submission (very plausible, especially under
  B1's known mail-delivery delay) could burn through all 5 without ever
  getting a second real email. A server-side fix was considered and rejected:
  skipping the charge only when the server-side cooldown would block the send
  is itself an oracle — the address counter would deplete normally for a
  nonexistent or already-verified address, but never for a real pending one,
  which is a way to enumerate live entries and undermines the same
  non-disclosure guarantee the rest of this code goes out of its way to keep.
  Fixed client-side instead:
  [components/public/raffle-form.tsx](../../components/public/raffle-form.tsx)
  now disables **Send it again** for the same 2 minutes the server would have
  silently refused it, showing a live countdown instead of the click
  appearing to do nothing. The server-side rate limiter is untouched — this
  only stops the wasted click from being sent at all. `RESEND_COOLDOWN_SECONDS`
  moved from `lib/raffle/service.ts` to `lib/raffle/limits.ts` so the client
  component could import it without pulling in `node:crypto`. Also mirrored to
  session storage, keyed to the address it was armed for, so a reload does not
  forget it — code review caught that the primary submit button reached the
  same server no-op through an untouched path otherwise. New tests in
  `tests/unit/raffle-form.test.tsx` cover the countdown, its re-arming on an
  actual resend, and surviving a reload.
- **C2. `hasCronSecret` exists twice
  ([#7](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/7), fixed —
  pending merge).** The outbox route's own copy now imports
  [lib/security/cron-auth.ts](../../lib/security/cron-auth.ts) instead.
- **C3. No error-grouping dashboard
  ([#8](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/8)).**
  `@sentry/nextjs` could not be installed on
  2026-07-30 — it pulls `webpack@5.109.2`, which depends on an unpublished
  `enhanced-resolve@^5.24.4`. Unblocking it means pinning webpack through a pnpm
  override. Revisit after the event; see the closing section of
  [monitoring.md](monitoring.md).
- **C4. Teardown.** The Resend plan and the raised rate limit are for this event
  only and are cancelled by 2026-08-31 — the runbook owns that step. Add the
  monitoring service and any webhook to the same list.
- **C6. A resend after link expiry sent nothing and said nothing — fixed
  2026-08-03** ([#5](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/5),
  formerly R5). `resendVerification` was always going to be silent for an
  expired token — that behaviour is intentional, the same non-disclosing
  acceptance every other outcome on that path gets — but the acknowledgement
  screen never told a stuck visitor that resending would not help them or
  what would. [components/public/raffle-form.tsx](../../components/public/raffle-form.tsx)
  now shows a permanent, always-visible line on the "Check your email"
  screen — not conditional on having tried a resend first — pointing back to
  the entry form, with the address the visitor already typed still filled
  in. Chosen deliberately for the project owner's stated priority: someone
  with low IT literacy has to be able to get unstuck without knowing *why*
  nothing arrived. Issue #5 can be closed.
