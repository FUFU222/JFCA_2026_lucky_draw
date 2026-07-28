# Lucky Draw pre-launch checklist

Work top to bottom. Nothing below the QR line may be skipped: once a code is
printed, the URL it points at cannot be changed.

## 1. Supabase project

- [ ] Create the production project and note its URL, anon key, and service-role key.
- [ ] Apply the schema: `pnpm exec supabase link --project-ref <ref>` then
      `pnpm exec supabase db push`. Confirm all four migrations applied.
- [ ] Insert the campaign (see the SQL in [README.md](../../README.md)). It is
      created `DRAFT` with no dates on purpose.
- [ ] Auth → URL configuration: add `https://luckydraw.livapon.com/auth/callback`
      to the redirect allow list. Without it the operator sign-in link silently
      lands on the project's default site URL.
- [ ] Auth → Rate limits: leave the hourly email limit low. Operator sign-ins are
      rare, and a high limit is a mail-bombing lever.
- [ ] Auth → Email templates: the sign-in mail is sent by Supabase, not Resend.
      Configure SMTP, or accept Supabase's low default sending limit and test it.

## 2. Resend

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

- [ ] Confirm the cron in `vercel.json` appears under Settings → Cron Jobs and is
      enabled. Without `CRON_SECRET` it will receive 401 and no retry will ever
      run.
- [ ] Decide `RAFFLE_IP_REQUEST_LIMIT`. The default is 500 per address per day.
      **Read the venue note in the on-site runbook before lowering it.**

## 5. Legal and content

- [ ] Final Lucky Draw terms wording approved.
- [ ] Wording placed in `lib/campaign/legal.ts`, and `LUCKY_DRAW_TERMS_VERSION`
      bumped from `jfca-2026-terms-v1-placeholder` in the **same** change as the
      campaign's `terms_version`, so a stored consent always points at the text
      that was shown.
- [ ] Both languages read by a native speaker of each.

## 6. Event schedule

Set from SQL or the Supabase table editor. No deploy is needed and there is no
prize data in the application at all.

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
