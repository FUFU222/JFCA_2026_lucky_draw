# Lucky Draw on-site runbook

For the operator at the venue. Everything here is done from the dashboard at
`https://luckydraw.livapon.com/admin` or from the Supabase table editor.

**The admin screens are in Japanese; the visitor's pages are in English.** Every
control this runbook names is quoted exactly as it appears on screen, so it can
be searched for. Where a visitor-facing label is meant, it is in English for the
same reason.

## Before doors open

0. **Sign in on a second device and leave that session open.** The magic link is
   the only way in. Supabase allows 30 sign-in emails an hour across the whole
   project, and enforces a **60-second wait between links to the same address**
   — during that minute a request produces no email and no error, so pressing
   the button again does not help. If you are locked out entirely, entrant data
   can still be read from the Supabase table editor.

1. Sign in at `/admin/login` with your `@chairman.jp` address. The link arrives
   from `noreply@mail.app.supabase.io`; check spam if it does not appear.
2. Check 概要: 状態 should read **受付中**, and **送信待ちメール数** should be at
   or near zero.
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

1. Search their address under **応募一覧**. If nothing is found, they mistyped it
   — have them enter again.
2. If the entry is 確認待ち, ask them to use **Send it again** on their own page
   (that screen is in English). The first submission already used one of the
   three daily sends, so they have two resends, with a two-minute wait between
   them.
3. Check **メール配信エラー** on 概要. A message there names the provider's reason.
4. **送信待ちメール数** is briefly non-zero during normal traffic — every
   confirmation queues a receipt that is sent immediately.

   **A number that climbs and stays up is normal, and the fix is one click.**
   The retry worker asks GitHub for a run every 5 minutes and does not get one:
   measured, the real gap is a median of 88 minutes and can reach 3 hours.
   Do not wait for it. Go to the repository's **Actions** tab → `Email outbox
   retry worker` → **Run workflow**, and the queue drains in seconds. It moves
   at most 20 messages per run, so press it again if the number is large.

   If a manual run goes red, open it: the workflow prints its own reason.
   Missing `APP_URL` / `CRON_SECRET` repository secrets, or a `CRON_SECRET` that
   no longer matches the Vercel environment variable, is what it looks like.

This gauge counts real entrants only. Your own test-mode rehearsals never appear
in it, and neither do they appear in 確認済み応募数 or 確認待ち.

## Someone lost their number

The receipt link never expires, so it is still in their inbox. **The most
recent confirmation email works too** — opening that link again takes them to
their number rather than saying it has been used. Only the most recent one:
if they used **Send it again**, the earlier links belong to spent cycles and
still read as unusable. If they cannot find either email:

1. Search their address under **応募一覧** and read the number to them.
2. If they contact you later, they are directed to `info@chairman.jp`. An
   operator looks the entry up and replies within two to three days.

There is deliberately no way to resend a receipt email and no way to reissue a
number.

## Starting, pausing, and closing entries

概要 shows only the buttons that make sense for the current state:

- **今すぐ受付を開始** appears while the campaign is `DRAFT`, and opens intake
  the moment you press it. Nothing has to be set up first.
- **受付を一時停止** stops new entries immediately but does **not** stop someone
  who already holds a link from confirming and getting their number, which is
  deliberate: they entered while it was open. **受付を再開** undoes it, and
  visitors can enter again immediately. While paused the state line reads
  **一時停止中**, not 受付終了 — the event has not ended.
- **受付を終了** is different from pausing: it is the end of the event, and
  refuses confirmation as well as new entries. Use it only when entries are
  genuinely finished — the closing step in [After the event](#after-the-event)
  below. **If you press it by mistake, 受付を再開 is there on the closed
  screen** and puts everything back. Every press of either is recorded against
  your account, so recovering from a slip is a normal thing to do, not
  something to hide.

**受付を再開 is for the minute after a mis-tap, not for after the draw.** A
verification link stays usable for 24 hours, and closing is the only thing
stopping the people holding one from taking a number. Reopen once the CSV is
exported and the draw is done, and any of them can still claim a number — one
that is in no exported list and cannot win. That is why it is not the inviting
button on the closed screen. If somebody genuinely needs to be let in after
the draw, that is a decision to make deliberately, not a tap.

Every one of these asks first, キャンセル is the default, and all four actions
are recorded against your account.

**This event has no schedule set — these buttons are the whole mechanism.**
Nothing opens or closes on its own, which means one rule matters more than any
other:

> **受付を終了 before you export the CSV for the draw.** A verification link
> stays usable for 24 hours, so somebody who entered but never confirmed can
> still claim a number until intake is closed. Close first, then export, and
> the pool is fixed. Export first and somebody can still join it afterwards.

An optional backstop exists if you want one — see
[prelaunch-checklist.md](prelaunch-checklist.md) section 6 — but it is not in
use for this event.

After you close, anyone who opens a confirmation link they never used is told
**Entries are closed**, on the link's own page. They are not sent back to the
form to try again, because that would only meet the same wall one tap later.

### What the state line means

| Shown | Meaning |
| --- | --- |
| 未開始 | `DRAFT`. Nothing has been started; the visitor's page says entries are not open yet, and no number is issued. |
| 開始待ち | Scheduled, but the opening time has not arrived. |
| 受付中 | Open. Visitors can enter. |
| 一時停止中 | You paused it. Reversible with 受付を再開. |
| 受付終了（抽選時刻） | Still scheduled, but within 30 minutes of the draw, so intake closed automatically. |
| 受付終了 | You closed it. 受付を再開 brings it back if that was a mistake — read the warning above before using it after the draw. |

## Checking the flow mid-event, without affecting the draw

**テストモードで開く** on 概要 opens the real entry form with everything marked as
a rehearsal. Use it whenever you need to confirm the journey still works.

- It uses the real form and sends real email, so it exercises what visitors
  actually experience.
- The number comes from a separate sequence starting at **900000001**, so it can
  never collide with a visitor's number.
- Test entries are excluded from 確認済み応募数, 確認待ち, 送信待ちメール数 and the
  CSV export. They appear in 最近の応募 and 応募一覧 badged **テスト**, which is
  how you confirm the rehearsal worked.
- It ignores the schedule, the rate limits and the captcha, so it works before
  opening, after closing, and while paused.
- **The same address can be reused every time.** Submitting it again resets the
  previous rehearsal and runs the whole journey afresh, including a new
  verification email and a new receipt email. You do not need a fresh address
  per rehearsal.
- Rehearsing on an address a **real** entrant already used is refused, with a
  message saying so. That is deliberate: overwriting their row would drop them
  out of the draw. Use a different address.

To check only how the number-reveal screen looks, **プレビュー** in the top nav
renders it with no entry and no email at all.

Test entries stay in the database after the event with `is_test = true`. The CSV
export excludes them, so the exported row count will be lower than the row count
in the Supabase table editor. That difference is expected.

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

**応募一覧 → CSVをエクスポート.** It asks first and says how many rows will leave.
The file contains email addresses and profile details, so treat it accordingly:
it is UTF-8 with a byte order mark and opens directly in Excel. Every export is
recorded with who ran it and how many rows — never the rows themselves.

## After the event

1. Use **受付を終了** on 概要.
2. Confirm **送信待ちメール数** has reached zero. Do not go further until it has —
   a receipt still queued has not reached its owner yet.
3. Export the final CSV and store it wherever entrant data belongs.
4. **Cancel the Resend paid plan.** It was bought for this event only. Leave it
   cancelled by **2026-08-31**. Check the outbox is empty first, and that no
   entry is still 確認待ち with a link that has not expired — those visitors can
   still confirm within 24 hours of their last send.
5. Anything else bought for the event and not needed afterwards — a raised
   Resend API rate limit, for instance — goes at the same time and for the
   same reason. The retry worker runs on GitHub Actions, not a paid Vercel
   plan, so there is nothing to cancel there.
