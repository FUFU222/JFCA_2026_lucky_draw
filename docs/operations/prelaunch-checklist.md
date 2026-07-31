# Lucky Draw pre-launch checklist

**The event is Saturday 15 August 2026, in Toronto (`America/Toronto`).**
Everything dated in this file is relative to that: the Resend teardown, the
rate-limit request, and every "before the event" below.

Work top to bottom. Nothing below the QR line may be skipped: once a code is
printed, the URL it points at cannot be changed.

The dry run happens on production, not on staging — see section 7. Staging
([staging.md](staging.md)) is now only for the load test, because it is the one
thing that must not run against the real database.

## 1. Supabase project

- [ ] Create the production project and note its URL, anon key, and service-role key.
      The project in use for this event is **`eyysljemlsghdxjaxjbn`**.
- [ ] Apply the schema: `pnpm exec supabase link --project-ref <ref>` then
      `pnpm exec supabase db push`. Confirm every migration in
      `supabase/migrations/` applied — `pnpm exec supabase migration list` should
      show the same list locally and remotely.
- [ ] Insert the campaign (see the SQL in [README.md](../../README.md)). It is
      created `DRAFT` with no dates on purpose.
- [ ] **Auth → Providers → Email: turn "Confirm email" ON.** With it off, anyone
      holding the public anon key — which ships in the browser bundle — can call
      `signUp` with any address they type, including `anything@chairman.jp`, and
      receive an immediately-confirmed session. That is full access to every
      entrant's personal data and to pause/close. Verified by exploit against a
      default project. The application also refuses a session that never came
      through the emailed link, but do not rely on one layer.
- [ ] After enabling it, confirm the bypass is closed:
      `curl -s -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $ANON_KEY" \
        -H 'content-type: application/json' \
        -d '{"email":"probe@chairman.jp","password":"aVeryLongTestPassword1!"}'`
      must **not** return an `access_token`.
- [ ] Auth → URL configuration: add `https://luckydraw.livapon.com/auth/callback`
      to the redirect allow list. Without it the operator sign-in link silently
      lands on the project's default site URL.
- [ ] Auth → Rate limits: confirm **"Rate limit for sending emails" is 30 per
      hour**. It was deliberately raised from Supabase's default of 2, which is
      low enough that a couple of sign-in attempts lock everyone out for the
      rest of the hour. Supabase also enforces a **60-second cooldown per
      address** that is not configurable here: an operator who asks for a second
      link too soon gets nothing and no error, so tell them to wait a minute
      rather than keep pressing the button.
- [ ] Auth → SMTP: **left on Supabase's built-in sender on purpose.** The
      operator sign-in link comes from Supabase, not from Resend, and arrives
      from `noreply@mail.app.supabase.io`. Supabase documents that sender as
      best-effort with no delivery SLA, which is acceptable here because only a
      few staff ever sign in and 30/hour covers them. If sign-in mail starts
      landing in spam, the fix is to point Auth → SMTP at the same provider as
      the transactional mail — but do not do it pre-emptively: a custom sender
      starts at its own 30/hour limit and needs its own domain verification.
- [ ] **Have every operator sign in once, before the event**, on the device they
      will use on the day. `getOperatorSession()` only trusts an account that
      already has an `ADMIN_LOGIN` audit row, so the very first sign-in is the
      one that must not happen under time pressure.

## 2. Resend

The plan and the raised rate limit are for this event only — see the teardown
step in [on-site-runbook.md](on-site-runbook.md). Cancel by **2026-08-31**.

- [x] **Choose a plan that covers roughly 60,000 messages**: about 30,000
      entrants, each receiving a verification email and a number receipt. The
      free allowance is nowhere near this. Pro was taken on 2026-07-29.

      **The tier does not have to be decided in advance, and should not be.**
      Pro includes 50,000 messages at $20 and 100,000 at $35, and going over
      the included figure does not stop anything: overage is charged
      automatically at $0.90 per 1,000, and sending only pauses at a hard cap
      of **five times** the plan quota — 250,000 messages on the 50K tier,
      which is about 125,000 entrants. This event cannot reach that. Resend
      also emails a warning at 80% of quota, which on the 50K tier lands at
      roughly 20,000 entrants.

      So: stay on 50K, watch the number during the day, and move up only if
      the volume genuinely arrives. The whole downside of guessing low is $9.
- [x] **Confirm a valid card is on file**, because that is what the automatic
      overage charge draws on. It is the one way the quota can actually stop
      the event: a declined card and the pause is not about volume any more.
      Confirmed 2026-07-30, on Pro.
- [ ] **Ask Resend to raise the API rate limit.** Requested 2026-07-30,
      awaiting a reply. **Read on Settings → Usage that day: 10 req/s**, the
      default, on Pro — so this is measured rather than assumed, and it does
      not vary by plan. Check that page again to confirm when it is granted.

      Sent through Settings → Usage → the help panel → **Talk to an expert**,
      at priority **Medium**. Not Critical: nothing is down, and mislabelling a
      planned request as an incident works against you with the team whose
      discretion you are asking for. Chase it if three working days pass with
      no reply — this cannot be fixed on the day.

      **This is the opposite of the plan tier above, and it is why it has to
      be done in advance.** The quota is soft, self-serve and reversible; the
      rate limit is a hard 429, cannot be changed from the dashboard, and
      needs a human at Resend support to grant it. There is no version of
      raising it at two in the afternoon with a queue at the booth.

      **Ask for 50/s.** Both messages are sent inline as visitors arrive, so
      30,000 entrants across a seven-hour day averages only ~2.4/s — but that
      is the average. Festival arrivals cluster, and a three-to-four-times
      peak puts the booth at 7–10/s, i.e. at the default ceiling with no
      margin at the exact moment a queue is forming.

      What makes this worth over-asking for: a 429 is not handled specially
      anywhere in the mail layer. It is an ordinary failure, so the message
      falls to `email_outbox` and waits for the retry worker — which asks for
      five minutes and really runs about every 88. The visitor standing at the
      booth gets nothing, and their own **Send it again** hits the same
      ceiling. The rate limit is the critical path here, not a backstop.
- [x] **Verify the sending domain for `info@chairman.jp`.** Checked against
      live DNS on 2026-07-30, not against the dashboard's own status:

      - `resend._domainkey.chairman.jp` — DKIM public key published, so the
        signature carries `d=chairman.jp` and aligns with the From domain.
      - `send.chairman.jp` — `v=spf1 include:amazonses.com ~all` plus an MX to
        `feedback-smtp.us-east-1.amazonses.com`. This is the Return-Path
        domain, and it is the one SPF is actually evaluated against.
      - `chairman.jp` root SPF is `include:_spf.google.com` only, and **that is
        correct — do not add amazonses to it.** SPF authenticates the envelope
        sender, which is `send.chairman.jp`, not the From header. Adding SES to
        the root would authorise Resend to send as ordinary company mail for no
        benefit.
      - DMARC is `p=none` with `rua=mailto:postmaster@chairman.jp`. Monitoring
        only, which is the right setting to be sending 60,000 messages under:
        nothing legitimate can be rejected by our own policy.
- [x] **Fixed the leading tab in the DMARC record**, 2026-07-30. The
      published value had a literal tab before `v=DMARC1`, which some
      evaluators trim and some do not — a coin flip on whether the policy was
      seen at all. **Editing the record in place did not remove it**;
      Squarespace's editor appears to insert one on save regardless of what
      is typed. Deleting the record and recreating it from scratch did.
      Confirmed clean against all four authoritative nameservers
      (`ns-cloud-c{1..4}.googledomains.com`) — DNS for `chairman.jp` is at
      Squarespace, not in any GCP project, despite those nameserver names.
- [x] **Gmail and iCloud confirmed landing outside spam**, 2026-07-30 —
      repeated real sends, not a one-off. **Outlook was not tested**: a
      decision to skip it and accept the risk, made 2026-07-30 rather than a
      gap nobody noticed. Worth revisiting only if time allows before the
      event; if an Outlook entrant reports missing mail on the day, the
      remedy is the same as a mistyped address — spam folder, then the
      operator looks the entry up in 応募一覧.
- [ ] Confirm the sender renders as `LIVAPON <info@chairman.jp>`.

## 3. Cloudflare Turnstile

- [ ] Create a production widget and add `luckydraw.livapon.com` to its hostnames.
- [ ] Copy the real site key and secret. The application refuses to start in
      production if either is one of Cloudflare's test values.

## 4. Vercel

- [ ] Add the domain `luckydraw.livapon.com` and complete DNS.
- [ ] Set every variable below for Production. The server refuses to start if any
      is missing, so a mistake here is a failed deploy rather than a silent one.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server only) |
| `NEXT_PUBLIC_APP_URL` | `https://luckydraw.livapon.com` |
| `RESEND_API_KEY` | Resend API key |
| `RAFFLE_EMAIL_FROM` | `LIVAPON <info@chairman.jp>` |
| `TURNSTILE_SECRET_KEY` | production secret |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | production site key |
| `RECEIPT_TOKEN_SECRET` | long random value, **never changed after launch** |
| `VERIFICATION_TOKEN_SECRET` | long random value |
| `CRON_SECRET` | long random value |
| `MAIL_DELIVERY_MODE` | `send` |
| `RAFFLE_IP_REQUEST_LIMIT` | `100000` — see the venue note below |
| `RAFFLE_EMAIL_REQUEST_LIMIT` | leave unset (defaults to 5) |

- [ ] **Add the two GitHub Actions repository secrets the retry worker needs**:
      `APP_URL` (the production origin, e.g. `https://luckydraw.livapon.com`)
      and `CRON_SECRET` (the same value as the Vercel environment variable).
      Settings → Secrets and variables → Actions, on the repository. The worker
      runs on GitHub Actions' schedule trigger rather than Vercel Cron
      specifically so the Hobby plan's once-a-day cron limit is not in the
      critical path — a failed confirmation email must not go undelivered for
      up to 24 hours on a one-day event.
- [ ] Confirm the workflow is enabled under the repository's **Actions** tab,
      and run it once manually (`workflow_dispatch`) to prove the two secrets
      are correct before relying on the schedule.
- [ ] The worker declares `maxDuration = 60`. Confirm the Vercel plan allows it;
      the deploy fails loudly if not.
- [x] **Set `RAFFLE_IP_REQUEST_LIMIT` high — 100000.** Done 2026-07-29. The
      window is a fixed 24 hours, not a sliding one, so a venue wifi or carrier
      NAT address that crosses the limit stays blocked for the rest of the
      event. The default of 500 is measured to be reached within the first hour
      at this scale. The per-address limit of 5 is the one that protects a
      person; leave it alone. A value that will not parse is refused at boot
      rather than falling back to the default, so a typo here is a failed
      deploy instead of a venue locked out mid-event.
- [x] **The HTTP-level load test was not run — a reasoned decision, not a gap.**
      See [staging.md](staging.md#load-test--not-run-for-this-event-and-why-that-is-a-reasoned-call)
      for the full reasoning. In short: the property it exists to prove is
      structurally guaranteed by a row lock, not empirically, and is now
      exercised directly at 80-way concurrency in
      `tests/integration/raffle-repository.test.ts`, at zero cost; the event's
      actual traffic ceiling is nowhere near the test's 100 req/s target; and
      the Free-tier 2-project limit made standing up a second cloud Supabase
      project cost real money or disrupt another live project for a question
      already answered. Decided 2026-07-30.

## 5. Legal and content

- [x] **Marketing consent split out of the required agreement.** Done
      2026-07-29. Entering needs one checkbox covering the entry only; LIVAPON
      news is a second, optional, unticked box that does not gate entry, with
      the moment of consent stored alongside it. The event is in Toronto and
      CASL wants consent to commercial email to be its own affirmative act.
- [x] **Terms wording and version fixed at `jfca-2026-terms-v1`.** Done
      2026-07-29, in `lib/campaign/legal.ts`, `supabase/seed.sql` and the
      production campaign row together.
- [ ] **Never edit `terms_version` in place once real entries exist.** A stored
      consent points at the wording that was on screen when it was given;
      relabelling it retroactively claims someone agreed to text they never
      saw. Changed wording means a new version, on a campaign with no entries
      or on the next event. The dashboard flags it when the campaign row and
      the code disagree.
- [ ] Every visitor-facing string read by a native English speaker. The public
      side is **English only** — the Japanese copy and the language switcher
      were removed, and `raffle_entries.locale` is constrained to `'en'`.
- [ ] The admin screens read by a Japanese speaker. That surface is **Japanese
      only**, and it is what the on-site runbook names its controls after.

## 6. Event schedule

**This event is run by hand, with no schedule set.** Staff are at the booth, so
the dashboard buttons decide everything and there is no SQL to write and no
timezone to get wrong. Leave `opens_at` and `draw_starts_at` unset.

- `DRAFT` — the page says entries are not open yet. This is the safe default.
- `SCHEDULED` — intake is on. 今すぐ受付を開始 puts it here.
- `PAUSED` — an operator stopped intake. Visitors who already hold a link can
  still confirm and get their number, which is deliberate: they entered while
  it was open.
- `CLOSED` — finished. Confirmation is refused as well as entry, and it is the
  only status that stops a number being issued. Recoverable with 受付を再開 if
  pressed by mistake.

> **The one thing manual operation costs you.** With no `draw_starts_at`, there
> is no automatic backstop: a verification link stays usable for 24 hours, so
> somebody who entered but never confirmed could still claim a number *after
> the draw* unless intake is closed. **受付を終了 before the draw is not
> optional** — it is the step that ends the pool. See the on-site runbook.

### If you would rather have a backstop

Both timestamps are optional bounds and can be set independently. Set from SQL,
**not** the table editor: a bare timestamp typed there is read as UTC, which
would open registration at 06:00 and close it at 12:30 local — in the middle of
the event. Always write the offset explicitly.

```sql
update public.campaigns
set draw_starts_at = '2026-08-15 17:00:00-04'  -- Toronto local, as an instant
where slug = 'jfca-2026';
```

With that set, intake stops on its own **30 minutes before** the draw, and a
number can never be issued past it even if nobody presses anything. `opens_at`
works the same way in the other direction: intake will not start before it,
whatever the status says.

Test-mode entries are the one exception —
they are exempt from both the schedule and this cut-off on purpose, so a
rehearsal works before opening and after closing.

## 7. Rehearsing on production without touching the draw

Two tools, for two different jobs. Neither can add a number to the real draw.

**Test mode** — for repeated functional rehearsals, any time, including during
the event. Covered in [on-site-runbook.md](on-site-runbook.md). It deliberately
skips the captcha, the rate limits and the schedule, which is what makes it
convenient — and also what it cannot prove.

**A rehearsal campaign** — for one full-fidelity run before launch, where every
gate test mode skips is live. This is a second campaign row in the production
database. Nothing about the code changes; every counter, every rate-limit
bucket and every dashboard and export query is already scoped by campaign, so a
run here cannot reach `jfca-2026`. Verified by running one and confirming the
real campaign's counter, entry count and rate-limit buckets were all untouched.

```sql
-- Stand it up. Open immediately, draw far enough out that the 30-minute
-- cut-off is not in the way.
insert into public.campaigns (slug, title, opens_at, draw_starts_at, status, terms_version)
values (
  'jfca-2026-rehearsal',
  'JFCA 2026 rehearsal',
  now() - interval '1 minute',
  now() + interval '7 days',
  'SCHEDULED',
  'jfca-2026-rehearsal'
);
```

- [ ] Walk the whole journey at
      `https://luckydraw.livapon.com/jfca-2026-rehearsal` on a real phone, on
      mobile data. **Use only addresses you control.** Real mail is sent, and
      the campaign is deleted afterwards, which takes those receipt links with
      it.
- [ ] Confirm the captcha actually challenged you, the confirmation email
      arrived from `info@chairman.jp` and not in spam, and the number page
      rendered — none of which test mode can tell you.
- [ ] Export it if you want the CSV path exercised too: the export route takes
      a slug, so `/admin/entries/export?event=jfca-2026-rehearsal`. The
      dashboard *page* is pinned to the real campaign, so rehearsal entries do
      not appear in 概要 or 応募一覧 — look them up in Supabase.
- [ ] Tear it down when the rehearsal is over:

```sql
-- Children first; the entry rows are what everything else hangs off.
with doomed as (select id from public.raffle_entries
                where campaign_id = (select id from public.campaigns where slug = 'jfca-2026-rehearsal'))
delete from public.email_deliveries where entry_id in (select id from doomed);
-- repeat for email_outbox and verification_tokens, then:
delete from public.raffle_entries
 where campaign_id = (select id from public.campaigns where slug = 'jfca-2026-rehearsal');
delete from public.campaigns where slug = 'jfca-2026-rehearsal';
```

- [ ] **Prove the real campaign is still pristine.** Run this last, whatever
      else happened, and do not print the QR code until it returns exactly
      `10000`, `900000001`, `0`, `0`:

```sql
select c.next_number,
       c.test_next_number,
       count(e.id) filter (where not e.is_test) as real_entries,
       count(e.id) filter (where e.is_test)     as test_entries
from public.campaigns c
left join public.raffle_entries e on e.campaign_id = c.id
where c.slug = 'jfca-2026'
group by c.next_number, c.test_next_number;
```

If it does not, something ran against the real campaign. Delete those entries
and reset the counters before opening — a number issued to nobody still
advances the sequence, so the first real visitor would not be 10000.

## 8. Before the QR code is printed

- [ ] `https://luckydraw.livapon.com/jfca-2026` resolves and its certificate is
      valid, checked from a Toronto network or an external Toronto probe.
- [ ] The exact production QR code scanned on a real iPhone and a real Android
      handset, on mobile data, not office wifi.
- [ ] On both handsets, the email field, the consent line and the send button
      are all reachable **without scrolling**. The optional profile section is a
      collapsed row above them; opening it must reveal all seven fields.
- [ ] A confirmation link opened, **Get my number** pressed once — there is no
      dialog on that page — and the number page screenshotted.
- [ ] The same link opened a second time — it must say the link cannot be used.
- [ ] A resend requested, and the cooldown message seen.
- [ ] Operator sign-in with a `@chairman.jp` address, and an address outside the
      domain refused.
- [ ] 今すぐ受付を開始, 受付を一時停止, 受付を再開 and 受付を終了 each exercised,
      and all four seen in the audit log. Check the state line reads 一時停止中
      while paused, not 受付終了.
- [ ] **受付を終了 pressed, then 受付を再開 from the closed screen**, and the
      campaign comes back. Closing is recoverable on purpose: those two buttons
      sit next to each other, and a stray tap at a busy booth must not end the
      event with no way back short of database access. Confirm the recovery
      shows in the audit log with `previous_status: CLOSED`.
- [ ] Test mode walked end to end: follow **テストモードで開く** from the
      dashboard, submit and confirm an entry, and confirm the number lands at
      900000001+ and never appears in the 確認済み応募数 / 確認待ち counts or the
      CSV export — only in 最近の応募 and 応募一覧, badged テスト.
- [ ] The **same test address submitted a second time**, and the whole journey
      re-run on it: the entry returns to 確認待ち, a fresh verification email
      arrives, the next number is 900000002, **and a second receipt email
      arrives**. This is the case that regressed once; the number appearing on
      screen does not prove the mail went out.
- [ ] A test-mode submission attempted on an address a real entry already holds.
      It must be refused with a message saying so, and that entrant's row must
      keep `is_test = false`.
- [ ] `/admin/preview` opened and アニメーションを再生 pressed, to confirm the
      number-reveal animation renders on the operator's device.
- [ ] A CSV exported and opened in Excel with Japanese names intact.
- [ ] `info@chairman.jp` reaches a monitored mailbox.

## 9. Alerting

- [ ] Vercel deployment and function failure notifications reach the operator.
- [ ] Supabase project health alerts enabled.
- [ ] Resend bounce and complaint notifications reach the operator.
- [ ] Someone is watching the dashboard's delivery-failure list during the event.
