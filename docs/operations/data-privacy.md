# Data privacy: retention, deletion, the data map, and who can reach what

Written 2026-07-31, closing [readiness-gaps.md](readiness-gaps.md) P1, P3 and
P4. The event is in Toronto, so PIPEDA is the frame; nothing here is legal
advice, it is the maintainer's operational answer to "what happens to this
data."

## Retention

**Decision (project owner, 2026-07-31): entrant data is deleted 90 days after
the event — 2026-11-13.**

90 days covers the realistic dispute window (a visitor who cannot find their
number, a question about whether an entry counted) without holding personal
data indefinitely for a one-day event. What is deleted:

- `raffle_entries`: email, first/last name, phone, gender, date of birth,
  country, region, marketing consent and its timestamp.
- Its children: `verification_tokens`, `email_outbox`, `email_deliveries` —
  cascade-deleted automatically (see below).

**What is not deleted**, and why: `admin_audit_logs` rows (who ran an export,
who signed in, when intake opened and closed) are the maintainer's own
operational record, not the entrant's personal data, and none of them
currently reference `entry_id` — the application never populates that column.
The issued **numbers and counts** are not personal data on their own and are
not required to be deleted; what this procedure removes is what could
identify a person, not the fact that a 10,347th entry existed.

## Deletion on request, before the draw

**Decision (project owner, 2026-07-31): a pre-draw deletion request
anonymizes the entry rather than removing it from the pool.** The person
keeps their place and, if already verified, their number; what is deleted is
everything that could identify them. This was chosen over dropping the row
because a dropped `VERIFIED` row would either leave a gap in the number
sequence or require renumbering everyone after it — neither is acceptable two
weeks from a live event — and because the person asking to be forgotten is
not the same as the person asking to withdraw from the draw.

**An unverified (`PENDING`) entry is deleted outright.** No number was ever
issued, so there is nothing to preserve.

### The SQL

Run by hand, once per request, until this is worth a script:

```sql
-- PENDING: nothing to preserve, delete the row. verification_tokens,
-- email_outbox and email_deliveries cascade automatically (all three
-- declare entry_id ... on delete cascade). admin_audit_logs.entry_id does
-- not cascade, but the application never sets it, so this is defensive
-- rather than load-bearing.
update public.admin_audit_logs set entry_id = null where entry_id = :entry_id;
delete from public.raffle_entries where id = :entry_id and state = 'PENDING';

-- VERIFIED: anonymize, keep the row, the number and receipt_token_hash (so
-- their own receipt link keeps working — they asked to be forgotten, not to
-- lose proof of their own number). email keeps its NOT NULL and non-empty
-- constraints, hence the placeholder rather than NULL.
update public.raffle_entries
set email = 'deleted-' || id || '@invalid.chairman.jp',
    first_name = null,
    last_name = null,
    phone = null,
    gender = null,
    date_of_birth = null,
    country = null,
    region = null,
    marketing_consent = false,
    marketing_consent_at = null
where id = :entry_id and state = 'VERIFIED';
```

**A deletion request during the event, mid-verification, is the PENDING
path**: nothing has been promised to them yet beyond a place in the queue for
a number, and no number has been issued.

### Process

- **Who answers `info@chairman.jp`:** the maintainer, same as every other
  support path in [on-site-runbook.md](on-site-runbook.md#someone-lost-their-number).
- **How fast:** within a few business days — there is no same-day
  expectation once the event itself is over, and PIPEDA does not require one.
- **What to check before running the SQL above:** the request is from an
  address that matches `raffle_entries.email` for that entry, the same bar
  every other support reply already uses implicitly (whoever asks has to
  name the address).

## The personal data map

| What | Where | Who can reach it | Leaves the system as |
| --- | --- | --- | --- |
| Email, name, phone, DOB, country, region | `raffle_entries` | Service-role key (server only); operators via `/admin` | The CSV export; redacted before any alert or log |
| Marketing consent + timestamp | `raffle_entries.marketing_consent(_at)` | Same as above | The CSV export only. Not sent anywhere else — see [readiness-gaps.md](readiness-gaps.md) P2, no platform is chosen yet and nothing is sent |
| Terms consent + version + timestamp | `raffle_entries.terms_consented_at`, `terms_version` | Same as above | The CSV export |
| Verification/receipt tokens | `verification_tokens`, hashed only — the plaintext is never stored | Nobody; not even the maintainer can reconstruct one from the database | Never. A resend recomputes the same HMAC; it does not read one back |
| Delivery status, provider errors | `email_deliveries`, `email_outbox` | Operators via the dashboard's 概要/メール配信エラー | Provider error text only, and only after the [alert webhook's](monitoring.md) redaction if it is ever included in an alert |
| Who did what, when (sign-ins, exports, campaign state changes) | `admin_audit_logs` | Operators via `/admin` | Row counts appear in alerts; never the underlying rows |
| The CSV itself | Wherever the operator saves it after export | The operator who exported it, and anyone they hand the file to | This is the export — see the retention decision above for how long it should live afterward |

Two things this table is what makes checkable: **the alert webhook**, which
carries redacted error text to a third-party chat service (Slack/Discord/
Google Chat) — this is the only personal-data-adjacent traffic that leaves the
system automatically, and [monitoring.md](monitoring.md) documents exactly
what redaction removes before it does. And **the unsubscribe promise** in
[readiness-gaps.md](readiness-gaps.md) P2, which is deliberately not sending
anything yet.

## Access: who holds which credential

**Decision (project owner, 2026-07-31): nobody else gets standing access.**
For a one-day event, adding a second credential holder was judged a bigger
new risk (a second copy of every secret, a second account that can be
phished or lost) than the one it would solve (the maintainer being
unreachable on the day). If the maintainer is unreachable during the event,
the booth runs on what is already decided and written down —
[on-site-runbook.md](on-site-runbook.md#the-system-is-down-not-just-the-venue-network)
— without needing new access granted on the spot.

| Service | Account | Where the credential lives |
| --- | --- | --- |
| Vercel | `fufu222` (team `fufu222s-projects`) | Password manager |
| Supabase | Project `eyysljemlsghdxjaxjbn`, org `FUFU222's Org` | Password manager; CLI access token on the maintainer's machine |
| Resend | Team `chairman` | Password manager |
| GitHub | `FUFU222`, repo `JFCA_2026_lucky_draw` (public) | Password manager; `gh` CLI token on the maintainer's machine |
| Cloudflare / DNS | chairman.jp domain, Squarespace-managed DNS | Password manager |

**Secrets that would need rotating if this decision ever changes** (a second
person is added later, or a credential is suspected leaked): `RESEND_API_KEY`,
`TURNSTILE_SECRET_KEY`, `CRON_SECRET`, `VERIFICATION_TOKEN_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`. **One secret cannot be rotated after launch
regardless:** `RECEIPT_TOKEN_SECRET` — rotating it invalidates every receipt
link already sitting in a visitor's inbox, which is worse than the exposure
it would be reacting to. If it is ever suspected compromised, the answer is
damage assessment, not rotation.
