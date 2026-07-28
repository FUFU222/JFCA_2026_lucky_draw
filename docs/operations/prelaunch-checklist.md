# Lucky Draw pre-launch checklist

Set staging up first — see [staging.md](staging.md). It is the only place the
load test and a full dry run can happen without sending real mail.

Work top to bottom. Nothing below the QR line may be skipped: once a code is
printed, the URL it points at cannot be changed.

## 1. Supabase project

- [ ] Create the production project and note its URL, anon key, and service-role key.
- [ ] Apply the schema: `pnpm exec supabase link --project-ref <ref>` then
      `pnpm exec supabase db push`. Confirm all four migrations applied.
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
- [ ] Auth → Rate limits: leave the hourly email limit low. Operator sign-ins are
      rare, and a high limit is a mail-bombing lever.
- [ ] **Auth → SMTP: configure a real sender.** The operator sign-in link is sent
      by Supabase, not by Resend. The built-in sender is rate limited to a
      handful of messages an hour and frequently lands in spam, so an operator
      who cannot sign in during the event has no way in. Point it at the same
      provider as the transactional mail and send a test.

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

- [ ] **Confirm the plan supports a per-minute cron.** `vercel.json` asks for
      `* * * * *`. On the Hobby plan cron jobs run at most **once a day**, which
      would leave a failed confirmation email undelivered for up to 24 hours —
      unusable for a one-day event. A paid plan is required, or the retry worker
      must be triggered from somewhere else.
- [ ] Confirm the cron appears under Settings → Cron Jobs and is enabled.
      Without `CRON_SECRET` it receives 401 and no retry will ever run.
- [ ] The worker declares `maxDuration = 30`. Confirm the plan allows it; the
      deploy fails loudly if not.
- [ ] **Set `RAFFLE_IP_REQUEST_LIMIT` high — 100000.** The window is a fixed 24
      hours, not a sliding one, so a venue wifi or carrier NAT address that
      crosses the limit stays blocked for the rest of the event. The default of
      500 is measured to be reached within the first hour at this scale. The
      per-address limit of 5 is the one that protects a person; leave it alone.
- [ ] Run the load test **without** raising the limit further, so it measures
      what the venue will actually experience.

## 5. Legal and content

- [ ] Final Lucky Draw terms wording approved.
- [ ] Wording placed in `lib/campaign/legal.ts`, and `LUCKY_DRAW_TERMS_VERSION`
      bumped from `jfca-2026-terms-v1-placeholder` in the **same** change as the
      campaign's `terms_version`, so a stored consent always points at the text
      that was shown.
- [ ] Both languages read by a native speaker of each.

## 6. Event schedule

Set from SQL, **not** the table editor: a bare timestamp typed there is read as
UTC, which would open registration at 06:00 and close it at 12:30 local — in the
middle of the event. Always write the offset explicitly. No deploy is needed and
there is no prize data in the application at all.

```sql
update public.campaigns
set opens_at       = '2026-08-15 10:00:00-04',  -- Toronto local, as an instant
    draw_starts_at = '2026-08-15 17:00:00-04',
    status         = 'SCHEDULED'
where slug = 'jfca-2026';
```

- `DRAFT` — the page says entries are not open yet. This is the safe default.
- `SCHEDULED` — entries open at `opens_at` and close automatically **30 minutes
  before** `draw_starts_at`. Nothing else needs doing on the day.
- `PAUSED` — an operator stopped intake from the dashboard. Visitors who already
  hold a link can still confirm and get their number.
- `CLOSED` — finished. Confirmation is refused as well as entry.

Confirmation is also refused once `draw_starts_at` passes, so a number can never
be issued after the draw has begun.

## 7. Before the QR code is printed

- [ ] `https://luckydraw.livapon.com/jfca-2026` resolves and its certificate is
      valid, checked from a Toronto network or an external Toronto probe.
- [ ] The exact production QR code scanned on a real iPhone and a real Android
      handset, on mobile data, not office wifi.
- [ ] English and Japanese both walked end to end on a phone.
- [ ] A confirmation link opened, confirmed, and the number page screenshotted.
- [ ] The same link opened a second time — it must say the link cannot be used.
- [ ] A resend requested, and the cooldown message seen.
- [ ] Operator sign-in with a `@chairman.jp` address, and an address outside the
      domain refused.
- [ ] Pause and resume exercised, and both seen in the audit log.
- [ ] A CSV exported and opened in Excel with Japanese names intact.
- [ ] `info@chairman.jp` reaches a monitored mailbox.

## 8. Alerting

- [ ] Vercel deployment and function failure notifications reach the operator.
- [ ] Supabase project health alerts enabled.
- [ ] Resend bounce and complaint notifications reach the operator.
- [ ] Someone is watching the dashboard's delivery-failure list during the event.
