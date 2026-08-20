# QA verification checklist — production, test mode

**Status (2026-07-31): §1–4 confirmed on production** by the project owner —
sign-in, campaign controls, test-mode entries and CSV export are all things
already done repeatedly in normal operation, so no fresh walkthrough was
needed. §5 (search) and §6 (rate limiting) remain.

Written 2026-07-31, after a local-environment QA simulation covered the
visitor journey end to end but could not reach the admin dashboard (the
magic-link email's redirect pointed at the local Supabase default port, not
the dev server's actual port — an environment quirk, not an app bug; see the
findings summary in the conversation this doc came from).

**What this closes:** everything below is real production, exercised through
**test mode** or a **rehearsal campaign** so nothing touches the real
`jfca-2026` pool. Full mechanics of both are already written up in
[prelaunch-checklist.md](prelaunch-checklist.md) §7 — this document does not
repeat that, it sequences it against what the local QA pass could not reach,
plus two checks that are not in that document at all (rate limiting,
audit log completeness).

Do this any time before D-2 (2026-08-13, the code freeze). It does not have
to be all in one sitting.

## 1. Sign in for real

- [ ] `/admin/login` with `a.tanaka@chairman.jp`, on the device you will
      actually use. Confirm the mail arrives from
      `noreply@mail.app.supabase.io` (check spam if not) and the link signs
      you in.
- [ ] This is also the first-sign-in check prelaunch-checklist.md §1 already
      requires — one sign-in satisfies both.

## 2. Campaign controls, with the audit log open in a second tab

Do these in order on the **real** `jfca-2026` campaign. All four are
reversible and this is what prelaunch-checklist.md §8 already asks for; the
addition here is checking the audit log after every single one, not just at
the end.

- [ ] 今すぐ受付を開始 (if not already `SCHEDULED`) → 概要 reads 受付中 →
      audit log shows a row.
- [ ] 受付を一時停止 → state line reads 一時停止中 (not 受付終了) → audit
      log row.
- [ ] Open the public URL in a private window while paused. **Confirm it
      reads the same "Entries are closed" copy CLOSED would show** — this is
      intentional (`lib/campaign/config.ts`, `registrationPhase`: "a visitor
      is never shown the difference between paused and closed"), not a bug.
      Knowing this in advance means the operator will not be surprised by it
      at the venue.
- [ ] 受付を再開 → back to 受付中 → audit log row.
- [ ] 受付を終了 → confirm the dialog states the consequence → audit log
      row.
- [ ] 受付を再開 from the closed screen → confirm the warning wording is
      about post-draw re-entry, not a generic "undo" → audit log row with
      `previous_status: CLOSED`.
- [ ] Leave the campaign in whatever state it should be in before the next
      person touches it (`DRAFT` or `SCHEDULED` — not `PAUSED` or `CLOSED`).

## 3. Test-mode entry, twice

Follow **テストモードで開く** from 概要.

- [ ] Submit one address. Number lands at 900000001+. Confirm it does **not**
      appear in 確認済み応募数, 確認待ち, 送信待ちメール数, or a CSV export —
      only in 最近の応募 / 応募一覧, badged テスト.
- [ ] **Submit the same address a second time.** This is the case
      prelaunch-checklist.md §8 calls out as "regressed once" — confirm the
      entry returns to 確認待ち, a fresh verification email arrives, and the
      next number is 900000002. A rehearsal that silently sends nothing
      while showing a number is the failure mode this step exists to catch.
- [ ] Attempt a test-mode submission on an address a **real** entry already
      holds. Confirm it is refused with a message saying so, and that real
      entry keeps `is_test = false`.

## 4. CSV export

- [ ] 応募一覧 → CSVをエクスポート. Confirm it asks first, states the row
      count, and the downloaded file's row count matches what the dashboard
      counted before exporting.
- [ ] Open it in Excel (or Numbers/Sheets) and confirm Japanese characters
      are intact (the file is UTF-8 with a BOM for exactly this).
- [ ] This also exercises the fix from today's session
      ([app/admin/entries/export/route.ts](../../app/admin/entries/export/route.ts)):
      if the row count silently mismatched, an error would now be reported
      instead of a short file arriving as if it were complete. Nothing to
      check here beyond the export completing normally — there is no way to
      force the mismatch path from the UI on purpose.

## 5. Search

- [ ] Look up the address used in §3 under 応募一覧. Confirm it is findable
      and badged テスト.

## 6. Rate limiting — not covered anywhere else

Neither prelaunch-checklist.md nor the local QA pass exercised what actually
happens when a limit is hit, only that the limits exist in config.

- [ ] Using **real** (non-test) submissions on a **rehearsal campaign** (see
      prelaunch-checklist.md §7 for standing one up — this keeps the real
      pool untouched), submit from the same address **6 times in a row**.
      Confirm the 6th is refused with a clear message, not a generic error.
- [ ] Confirm the message a real visitor sees matches what
      [on-site-runbook.md](on-site-runbook.md#the-venue-network-problem-read-this-before-changing-limits)
      describes staff saying ("Too many attempts") — if the wording drifted,
      the runbook needs updating, not the code.
- [ ] Tear down the rehearsal campaign per prelaunch-checklist.md §7's SQL,
      then run its "prove the real campaign is still pristine" query and
      confirm `10000`/`900000001`/`0`/`0` (or whatever the real campaign's
      current counters are, if entries already exist — the point is that
      this step changed nothing about them).

## What is still out of reach, and why that is fine

- **24-hour link expiry.** Cannot be tested without waiting 24 hours or
  altering a database timestamp by hand on production, which is not worth
  the risk for a code path that is simple (`verification_tokens.expires_at`
  compared to `now()`) and already covered by
  [tests/integration](../../tests/integration/) locally.
- **Venue wifi / shared-IP collisions.** Cannot be simulated without many
  distinct source IPs. `RAFFLE_IP_REQUEST_LIMIT` is already set high
  (prelaunch-checklist.md §4) specifically because this can't be rehearsed
  in advance — it is a day-of watch item, not a pre-event test.
