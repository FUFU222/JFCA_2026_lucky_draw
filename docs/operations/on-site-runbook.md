# Lucky Draw on-site runbook

For the operator at the venue. Everything here is done from the dashboard at
`https://luckydraw.livapon.com/admin` or from the Supabase table editor.

## Before doors open

0. **Sign in on a second device and leave that session open.** The magic link is
   the only way in, and Supabase rate limits those emails per hour: one link in
   a spam folder can lock the only operator out. If it happens, entrant data can
   still be read from the Supabase table editor.

1. Sign in at `/admin/login` with your `@chairman.jp` address. The link arrives
   by email; it is the only way in.
2. Check the overview: registration should read **Accepting entries**, and
   "Emails waiting to send" should be at or near zero.
3. Scan the printed QR code yourself and complete one real entry.

## The venue network problem, read this before changing limits

Entries are limited per address (5 a day) and per IP address (500 a day by
default). At a festival, hundreds of visitors share the venue wifi and a small
number of carrier NAT addresses, so **many visitors will appear to come from one
IP**.

- If visitors report "Too many attempts", raise `RAFFLE_IP_REQUEST_LIMIT` in
  Vercel and redeploy. The change takes effect on the next request, and it does
  unblock an address that is already over the limit.
- The window is a fixed 24 hours, not a sliding one, so waiting does **not**
  help a blocked address. Only raising the limit does.
- The same message also appears if the database is briefly unreachable, because
  the limiter fails closed. If raising the limit changes nothing, check Supabase
  before raising it again.
- The per-address limit of 5 is what actually protects a person. Leave it alone.

## Someone did not get their email

1. Search their address under **Entries**. If nothing is found, they mistyped it
   — have them enter again.
2. If the entry is `PENDING`, ask them to use "Send it again" on the page. The
   first submission already used one of the three daily sends, so they have two
   resends, with a two-minute wait between them.
3. Check **Email delivery failures** on the overview. A message there names the
   provider's reason.
4. "Emails waiting to send" is briefly non-zero during normal traffic — every
   confirmation queues a receipt that is sent immediately. A number that climbs
   and does not fall means either the worker is not running (check the
   repository's **Actions** tab for the `Email outbox retry worker` workflow,
   and that `CRON_SECRET` matches between the GitHub Actions secret and the
   Vercel environment variable) or it is at its cap of 20 messages per run,
   which is the more likely cause after a provider incident.

## Someone lost their number

The receipt link never expires, so it is still in their inbox. If they cannot
find it:

1. Search their address under **Entries** and read the number to them.
2. If they contact you later, they are directed to `info@chairman.jp`. An
   operator looks the entry up and replies within two to three days.

There is deliberately no way to resend a receipt email and no way to reissue a
number.

## Stopping entries in a hurry

Use **Pause registration** on the overview. It asks first, and Cancel is the
default. Pausing stops new entries immediately. It does **not** stop someone who
already holds a link from confirming and getting their number, which is
deliberate: they entered while it was open.

Resume the same way. Both actions are recorded against your account.

## What this service will not do

Asked for any of these at the venue, the answer is that the system cannot:

- edit or reissue a number,
- tell anyone whether they have won,
- accept the winning numbers,
- resend a receipt email automatically,
- show prize names, quantities, or collection details.

Results are announced at the venue and visitors compare them with their own
number.

## Exporting entrant data

**Entries → Export CSV.** It asks first and says how many rows will leave. The
file contains email addresses and profile details, so treat it accordingly: it
is UTF-8 with a byte order mark and opens directly in Excel. Every export is
recorded with who ran it and how many rows — never the rows themselves.

## After the event

1. Set the campaign to `CLOSED`.
2. Confirm "Emails waiting to send" has reached zero. Do not go further until it
   has — a receipt still queued has not reached its owner yet.
3. Export the final CSV and store it wherever entrant data belongs.
4. **Cancel the Resend paid plan.** It was bought for this event only. Leave it
   cancelled by **2026-08-31**. Check the outbox is empty first, and that no
   entry is still `PENDING` with a link that has not expired — those visitors
   can still confirm within 24 hours of their last send.
5. Anything else bought for the event and not needed afterwards — a raised
   Resend API rate limit, for instance — goes at the same time and for the
   same reason. The retry worker runs on GitHub Actions, not a paid Vercel
   plan, so there is nothing to cancel there.
