# Lucky Draw on-site runbook

For the operator at the venue. Everything here is done from the dashboard at
`https://luckydraw.livapon.com/admin` or from the Supabase table editor.

## Before doors open

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

- If visitors start reporting "Too many attempts", that is the per-IP limit, not
  a fault. Raise `RAFFLE_IP_REQUEST_LIMIT` in Vercel and redeploy; the change
  takes effect on the next request.
- Never lower it below a few hundred for a physical event.
- The per-address limit of 5 is what actually protects a person. Leave it alone.

## Someone did not get their email

1. Search their address under **Entries**. If nothing is found, they mistyped it
   — have them enter again.
2. If the entry is `PENDING`, ask them to use "Send it again" on the page. There
   is a two-minute wait between sends and three in total per day.
3. Check **Email delivery failures** on the overview. A message there names the
   provider's reason.
4. "Emails waiting to send" above zero and not falling means the retry worker is
   not running. Check the Vercel cron job.

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
2. Export the final CSV.
3. Confirm "Emails waiting to send" has reached zero.
