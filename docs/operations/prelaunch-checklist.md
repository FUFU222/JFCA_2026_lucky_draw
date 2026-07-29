# Lucky Draw pre-launch checklist

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

- [ ] **Choose a plan that covers roughly 60,000 messages**: about 30,000
      entrants, each receiving a verification email and a number receipt. The
      free allowance is nowhere near this.
- [ ] **Ask Resend to raise the API rate limit.** The default is around two
      requests per second. Both messages are sent inline as visitors arrive, so
      30,000 entrants over seven hours averages above that before any peak. This
      needs a support request, so raise it on the same day as the plan change.
- [ ] Verify the sending domain for `info@chairman.jp`: SPF and DKIM records
      published, and DMARC checked if the domain has a policy.
- [ ] Send one test message to a Gmail address and one to an Outlook address, and
      confirm both land outside spam.
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
- [ ] Run the load test **without** raising the limit further, so it measures
      what the venue will actually experience.

## 5. Legal and content

- [ ] **Decide whether marketing consent stays bundled into the required
      agreement.** Entry currently requires one checkbox, and the terms behind
      it also cover LIVAPON news — so entering means accepting marketing. The
      event is in Toronto, so CASL applies. Splitting it into a second,
      optional checkbox is about an hour of work and has to happen before
      launch if it is going to happen at all. A team decision, not one
      person's.
- [ ] Final Lucky Draw terms wording approved.
- [ ] Wording placed in `lib/campaign/legal.ts`, and `LUCKY_DRAW_TERMS_VERSION`
      bumped from `jfca-2026-terms-v1-placeholder` in the **same** change as the
      campaign's `terms_version`, so a stored consent always points at the text
      that was shown.
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
