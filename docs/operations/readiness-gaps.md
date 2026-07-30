# Readiness gaps

What is still unverified or missing, in one place, with a deadline against each
item. Written 2026-07-30.

The other operational documents describe **what to do**. This one records **what
has not been done**, which is a different thing and is the part that goes wrong
when nobody is holding a list. Two of the entries below are not tasks at all —
they are decisions to accept a known defect, recorded so they cannot later be
discovered by surprise.

## How to read this

- **D** is the day of the event. **It is not recorded anywhere in this
  repository** — the only date in the documents is an illustrative
  `2026-08-15 17:00:00-04` inside an example `update` statement in
  [prelaunch-checklist.md](prelaunch-checklist.md) §6. Confirm the real date and
  write it here first; every deadline below is relative to it.

  > D = ______ (fill this in)

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

### B1. The Resend API rate limit is still the default (S1, by D-7)

The plan is settled: Pro was taken on 2026-07-29, the quota is soft, and going
over it costs cents rather than stopping the event. That work is done and
[prelaunch-checklist.md](prelaunch-checklist.md) §2 now describes it correctly.

**The rate limit is the part that is not done, and it is the opposite kind of
problem.** The default is 10 requests per second per team, it cannot be changed
from the dashboard, and it needs a human at Resend support to raise. Both
messages are sent inline as visitors arrive: a seven-hour day at 30,000 entrants
averages ~2.4/s, and festival arrivals cluster three to four times over, which
puts the booth at the ceiling exactly when a queue is forming. A 429 is not
handled specially anywhere — the message falls to `email_outbox` and waits for a
worker whose real interval is about 88 minutes, and the visitor's own **Send it
again** hits the same ceiling.

- [ ] Ask Resend support for 50/s. **Send the request on the earliest possible
      day**; it is the one item here with a third party's response time in it.
- [ ] Confirm a valid card is on file. A declined card turns the soft quota into
      a hard stop, which is the only way volume can end the event.

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

## Accepted risks

Recorded rather than fixed. Each one is a decision, and the reason is the part
worth keeping.

| # | Risk | Why it is accepted |
| --- | --- | --- |
| R1 | An unverified entry's marketing consent can be overwritten by anyone resubmitting that address, leaving a consent timestamp that is evidence of nothing | Before verification nobody owns the row, and the person confirming cannot be told apart from the person who ticked the box. The real fix issues a fresh token whenever consent changes. Bounded by the 5/day per-address limit and it cannot yield a number. Fix before this code mails a list |
| R2 | A submit race can leave two live verification links for one entry; the second returns a 500 for 24 hours instead of "link cannot be used" | The issued number stays correct. The fix is in SQL and the race needs two requests for a brand-new address to interleave within milliseconds |
| R3 | The per-IP limit trusts `x-real-ip` / `x-forwarded-for` | Unverified rather than accepted — **confirm Vercel overwrites both on ingress**. If it does not, the limit is bypassable. This one should be checked before D |
| R4 | A Resend send is raced against a 10-second timeout rather than cancelled, so a retry can duplicate a message | Duplicates are preferred to losses |
| R5 | A resend after the link expired sends nothing, and the acknowledgement page does not say "submit the form again" | The service behaviour is intentional; the wording gap is real and small |

These came from [HANDOFF.md](../HANDOFF.md), which is where they were first
written down. They belong in an issue tracker rather than a prose document, so
each has a GitHub issue — that is what makes "we accepted this" survive the
person who accepted it.

## Cleanups

- **C1. The CSV export can truncate silently (S2, worth fixing before D).**
  [app/admin/entries/export/route.ts](../../app/admin/entries/export/route.ts)
  streams the file, so a failure part-way through arrives as a 200 with a short
  file. The row count is already known and recorded in the audit log but is never
  compared against what was written. The operator cannot tell a complete export
  from a truncated one, and the export is the draw pool.
- **C2. `hasCronSecret` exists twice.**
  [lib/security/cron-auth.ts](../../lib/security/cron-auth.ts) and the copy inside
  the outbox route. Deliberately not merged this close to the event; merge after.
- **C3. No error-grouping dashboard.** `@sentry/nextjs` could not be installed on
  2026-07-30 — it pulls `webpack@5.109.2`, which depends on an unpublished
  `enhanced-resolve@^5.24.4`. Unblocking it means pinning webpack through a pnpm
  override. Revisit after the event; see the closing section of
  [monitoring.md](monitoring.md).
- **C4. Teardown.** The Resend plan and the raised rate limit are for this event
  only and are cancelled by 2026-08-31 — the runbook owns that step. Add the
  monitoring service and any webhook to the same list.
