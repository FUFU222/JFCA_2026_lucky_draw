# Plan — stop sending the receipt email

Written 2026-07-30. **Implemented the same day**, with one correction the plan
did not see coming — see [What this plan got wrong](#what-this-plan-got-wrong).

Event date confirmed while this was being written: **2026-08-15, intake closing
18:00 Toronto**. That is D-16, which is what made this the last feature change
before the freeze rather than a post-event idea.

## Why this is possible now, and was not yesterday

`818c271` made a used verification link redirect to the number it issued, and
`issuedReceiptToken()` never checks `expires_at` — it only asks whether a
receipt exists for the token being presented. So **a verification link is
already a permanent way back to the number**, long after the 24 hours in which
it could still claim one.

That changes what the receipt email is. It was the only durable copy of the
number. It is now a second durable copy of something the visitor already holds
in the same inbox.

## The decision

Stop sending the `RECEIPT` email. Keep everything else: verification, the
permanent number URL, the receipt token, the outbox.

### What it buys

| | Now | After |
| --- | --- | --- |
| Messages for 30,000 entrants | 60,000 | **30,000** |
| Against the Pro allowance of 50,000 | 10,000 over | **20,000 under** |
| Average send rate | 2.4/s | 1.2/s |
| Peak at 3–4× arrivals | 7–10/s | **3.6–4.8/s** |
| Against the team's 10 req/s limit | at the ceiling | half of it |
| Pay-as-you-go | required | never fires |
| The 50/s support request | a blocker (B1, S1) | insurance (S2) |

The rate limit is the real prize. At 7–10/s against a 10/s ceiling, a 429 falls
to an outbox whose measured interval is 88 minutes, and the visitor is standing
at the booth. At 3.6–4.8/s there is roughly a 2× margin, and the one remaining
message is the one the visitor can retry themselves with **Send it again**.

### What it costs

One thing, precisely: **an email containing the number as text, readable with no
network.** The link path needs connectivity and a live deployment at the moment
it is tapped — which is exactly what a saturated venue network at announcement
time threatens.

A screenshot is immune to both. So the mitigation is not new advice, it is
making advice that already exists impossible to miss: `messages.receipt.screenshot`
already reads "Save this number. A screenshot is the easiest way."

## What changes

### 1. Stop dispatching the receipt (the actual change)

`RaffleService.confirmVerification()` calls `trySendReceipt()` after the number
is issued (`lib/raffle/service.ts`). Remove that call.

**Everything downstream of it stays exactly as it is.** The `RECEIPT` outbox
kind, `EmailOutboxProcessor`'s handling of it, `mailer.sendReceipt()`,
`resend.ts`, the template, and the `check` constraint in migration `0003` are
all left alone.

That is not laziness — production already holds at least one entry (number
10000, from the incident `818c271` diagnosed) and its receipt outbox row. If the
worker lost the ability to process `RECEIPT` jobs, any row still `PENDING` could
never settle, 送信待ちメール数 would never reach zero, and `/api/health` would
report `degraded` for the rest of the event. Removing the dead plumbing is a
post-event cleanup, not part of this change.

### 2. Copy that becomes false

- `messages.receipt.emailed` — "We also emailed this number to you." Must go.
  Replace with the fact that matters: the confirmation email in their inbox
  opens this page again, any time.
- `messages.receipt.support` — "Lost your number? Contact …". Should lead with
  the self-service path and keep the address as the fallback.
- `emails/verification-email.tsx`, `copy.expiry` — "This link works for 24
  hours. After that, submit the entry form again to get a new one." Half true
  since `818c271`: 24 hours is the window to *claim* a number, but once claimed
  the link keeps working forever. It should say both, and say to keep the email.

The verification email is now the durable artifact. Its subject line and its
first paragraph should be written as though the visitor will come back to it in
six hours looking for their number — because that is now its main job.

### 3. The number page, so saving is unmissable

Today: a large number, `screenshot`, `venue`, then `emailed` and `support` in
small text below a rule.

- Move the save prompt above the fold with an icon beside it, not a bare
  sentence in the same weight as everything else.
- Add a **copy-link button**. One tap puts the permanent URL on the clipboard,
  and the visitor can paste it into their own notes, LINE or messages — a
  durable copy under their control, in whatever app they actually use.
- Add one line of text for the bookmark / add-to-home-screen path. No JS.

**Trade-off to accept deliberately:** the copy button makes this the first
client component on that page. `number-receipt.tsx` currently notes that its
confetti is "purely CSS: no JS, no bundle cost". This adds a small amount. For
the one screen the whole visit exists to reach, worth it — but it is a real
change to a stated property of that file, so it belongs in the review rather
than in a diff nobody looks twice at.

### 4. Documents

- `on-site-runbook.md`, "Someone lost their number" — rewrite. First answer is
  now "open the confirmation email and tap the link again". Address lookup in
  応募一覧 drops to second.
- `prelaunch-checklist.md` §8 — the test-mode item asserting **a second receipt
  email arrives** is checking a behaviour that will no longer exist. It was
  written because that case regressed once, so it should be replaced by the
  equivalent check for what does exist: re-opening a used link lands on the
  number.
- `HANDOFF.md` — "Mail is inline first, durable second" and the `resetTestEntry`
  note about receipt jobs both need a sentence.
- `readiness-gaps.md` — B1 drops to S2.

### 5. Tests

Failing after this change, and each one should be turned into its opposite
rather than deleted: the service test asserting a receipt is dispatched on
confirmation, the outbox integration test for the receipt job, and the test-mode
test asserting a second receipt arrives on re-submission.

Add: confirming issues a number and sends **no** second message.

## What this deliberately does not do

- **It does not touch email verification.** That was the other idea on the table
  and it is a different, much larger change: numbering happens inside
  `confirm_raffle_verification`, which locks the campaign row, and HANDOFF says
  in as many words not to move it. Verification is what keeps one mailbox equal
  to one number and what makes the CASL consent defensible. Not now.
- **It does not remove the `RECEIPT` plumbing.** See above.
- **It does not add a "email me a copy" button.** Tempting — it would preserve
  the safety net for whoever wants it and cut volume to maybe a third — but it
  is a new public write endpoint two weeks before the event, with its own abuse
  surface (a receipt URL is a bearer token; a send button behind one is a mail
  bomb without a limiter). Post-event idea.

## What this plan got wrong

It said the change was one call site and some copy, and that no SQL was
involved. That was wrong, and the way it was wrong would have shipped a
half-change that looked complete.

**`confirm_raffle_verification` arms the receipt itself.** The function inserts
the `RECEIPT` outbox row inside the same transaction that issues the number, at
three separate points — the fresh path, the already-verified path, and the
repeat-confirmation path. Removing only the inline send would have left every
confirmation arming a job that the retry worker then picked up and delivered
about ninety minutes later. Same mail volume, same rate-limit ceiling, and a
receipt arriving long after the visitor left the booth: worse than either
option on the table.

`0010_no_receipt_email.sql` is `0009`'s definition with those nine lines
removed. It was generated from that file rather than retyped, and the result
diffed against the original to prove nothing else moved — this is the function
that guarantees two simultaneous confirmations of one link return one number,
and it is not a place to trust a careful copy-paste.

The plan's other claim held: nothing downstream was touched, so a receipt row
armed before the change can still be settled by the worker.

## Risks

| Risk | Judgement |
| --- | --- |
| A visitor with no screenshot, no network, at announcement time | The real cost. Mitigated by the save prompt, the copy button, and staff able to look the number up |
| More number lookups at the booth | Expected. The runbook change and a person free at announcement time cover it. Note the lookup needs the admin screens up, so it is not an offline fallback either |
| The verification email lands in spam and is the only artifact | Already true today for the journey itself: no verification email, no entry at all. Not made worse |
| Somebody re-reads the old copy and expects a second email | Which is why the copy changes are part of this change and not a follow-up |

## How it gets verified

1. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
2. Local walk: submit → confirm → number shown → **no second message** in
   Mailpit → close the tab → re-open the verification link → the number again.
3. Test mode: submit the same address twice and confirm the rehearsal still
   re-runs, with one verification email each time and no receipt.
4. Production rehearsal campaign, on a real phone, on mobile data — the section
   of the pre-launch checklist that already exists for this.
5. Code review before merge.

## Rollback

Restoring the `trySendReceipt()` call restores the old behaviour, since nothing
downstream is removed. Copy and documents would have to come back with it. The
one thing that cannot be undone: entrants who confirmed while it was off never
got a receipt email, and there is deliberately no way to send one after the
fact.

## Open question before implementing

**The event date.** If it is inside two weeks, this is the last change that
should land before a freeze, and the S1 items in `readiness-gaps.md` — backup
restore, the load test, switching monitoring on — come first regardless.
