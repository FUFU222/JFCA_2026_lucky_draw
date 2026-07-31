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

### B2. The Supabase plan is not recorded (S1, by D-7)

No document says which plan project `eyysljemlsghdxjaxjbn` is on, and the
difference decides whether the entrant data can be recovered at all. On the free
tier there is no point-in-time recovery, backups are limited, and a project
pauses after a week of inactivity — which is a real risk for a project that is
set up in July and needed in August.

- [ ] Write the plan and its backup capability into this file.
- [ ] If it is not on a paid plan, move it before the dry run, not after.

### B3. Backups have never been restored (S1, by D-7)

There is no backup or restore procedure anywhere in the repository. The entrant
table is the draw itself and cannot be re-collected.

- [ ] Decide and write down the two numbers every recovery plan needs: how much
      data may be lost (RPO) and how long recovery may take (RTO). For a
      one-day event where the pool is the deliverable, the honest answers are
      close to zero and under an hour.
- [ ] **Restore once, into a scratch project, and confirm the row counts.** A
      backup that has never been restored is a belief, not a backup.
- [ ] Export a CSV to a second location the moment intake closes, before
      anything else. It is the cheapest possible independent copy of the pool.

### B4. The load test has never been run (S2, by D-5)

The 100 requests/second target in [staging.md](staging.md) is unmeasured, and the
environment it needs does not exist: every Vercel build is `NODE_ENV=production`,
which the startup guard and the Turnstile check both key on, so the load test
needs the built app running somewhere else against a separate Supabase project.

- [ ] Stand that up and run it, or **record the decision not to** and say what is
      being accepted instead. Either is defensible; leaving the target in a
      document while never measuring it is not.

### B5. Monitoring is implemented but switched off (S2, by D-3)

Landed on this branch: a structured error log, an alert webhook, `/api/health`,
and an hourly `Production smoke` workflow. **Three of the four layers do nothing
until they are configured**, and the configuration is Web-UI work.

- [ ] Follow [monitoring.md](monitoring.md) §2 and §3: create the webhook, set
      `ALERT_WEBHOOK_URL` in Vercel, create the two always-on monitors.
- [ ] Confirm `detail.errorAlerts` reads `"on"` against production. Set-but-not-
      deployed reads `"off"`, which is how monitoring usually fails.
- [ ] Put the event-day `"accepting":true` monitor on the operator's checklist,
      including switching it off afterwards.
- [ ] The alerting items in [prelaunch-checklist.md](prelaunch-checklist.md) §9
      (Vercel, Supabase and Resend notifications) are all still unchecked and are
      not replaced by any of this.

### B6. There is no rollback procedure and no code freeze (S2, by D-3)

Vercel can roll a deployment back instantly. Nothing says so, nobody has done it
once, and there is no date after which changes stop.

- [ ] Roll back a deployment once on purpose, and write the steps down.
- [ ] Set a freeze date — **D-2 is the recommendation** — after which nothing
      ships but a fix for something found in the dry run.

### B7. There is no plan for the venue when the system is unavailable (S1, by D-2)

The rate limiter fails closed, so a Supabase outage shows every visitor "Too
many attempts" rather than an outage message. The runbook covers what to check;
it does not cover what the booth *does* for the twenty minutes it lasts.

- [ ] Decide the degraded-mode procedure and put it in the operator's hands: what
      the staff say, whether addresses are collected on paper and entered later
      (and if so, under which consent wording — the entry agreement is collected
      on screen, so paper needs its own answer), and who decides to switch.
- [ ] Name the one person who makes that call, and how they are reached.

## Missing mechanisms

### P1. No retention period, no deletion path (S2, by D-1 for the wording; the process can follow)

The system collects email addresses, optional profile fields including date of
birth, and marketing consent. Nothing states how long any of it is kept, and
there is no procedure for "delete my entry" — an ordinary request under PIPEDA,
and the event is in Toronto.

- [ ] Write the retention period down, and the date the entrant data is deleted.
- [ ] Write the deletion procedure, with the SQL, including the child rows
      (`email_deliveries`, `email_outbox`, `verification_tokens`) that
      [prelaunch-checklist.md](prelaunch-checklist.md) §7 already has to name for
      the rehearsal teardown.
- [ ] Decide who answers `info@chairman.jp` for such a request, and how fast.
- [ ] A deletion before the draw removes an entry from the pool. Decide now
      whether that is what happens, and say so in the terms if it is.

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
- [ ] Do not send anything to that list until both are answered.

### P3. Personal data has no map (S3, by D-1)

Related to P1 and cheap once it is done: one table listing what is collected,
where it lives, who can reach it, and what leaves the system (the CSV export, the
two emails, the alert webhook — which is why alerts are redacted). Standard
practice calls this a data map or ROPA; here it is a page, and it is what makes
answering a question about the data possible without reading the schema.

### P4. One person holds every credential (S2, by D-3)

Vercel, Supabase, Resend, GitHub, Cloudflare and DNS are all held by one account.
The runbook already says to sign in on a second device before doors open, which
addresses being locked out of the admin screens and nothing else.

- [ ] Write the access list: which service, which account, where the credential
      is kept.
- [ ] Decide what happens if that person is unreachable on the day, and give
      somebody else enough to run the booth.
- [ ] Note which secrets would have to be rotated afterwards if that access were
      shared, and which cannot be (`RECEIPT_TOKEN_SECRET` is permanent — rotating
      it breaks every receipt link already in an inbox).

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
| R5 | [#5](https://github.com/FUFU222/JFCA_2026_lucky_draw/issues/5) | A resend after the link expired sends nothing, and the acknowledgement page does not say "submit the form again" | The service behaviour is intentional; the wording gap is real and small |

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
