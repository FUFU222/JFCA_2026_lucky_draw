# Backup and restore

Written 2026-07-31, after [readiness-gaps.md](readiness-gaps.md) B2 and B3 found
that neither had ever been checked: the Supabase plan backing this event was
undocumented, and no backup had ever been restored.

## The plan, and what it actually gives you

Project `eyysljemlsghdxjaxjbn` (`jfca-2026-lucky-draw`) is on organization
**`FUFU222's Org`**, plan **Free**. Confirmed 2026-07-31 via the Supabase
Management API (`get_organization`).

Per Supabase's own documentation (read 2026-07-31, [Database
Backups](https://supabase.com/docs/guides/platform/backups) and [Project
Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)):

- **Free plan projects receive no automatic backup of any kind.** Daily
  backups are a Pro/Team/Enterprise feature; Point-in-Time Recovery is a paid
  add-on that requires Pro or above. Supabase's own recommendation for Free
  plan projects is exactly what this document sets up: run `db dump`
  yourself and keep the copy somewhere else.
- **Free plan projects are not available for backup download** even if one
  existed.
- **A Free plan project pauses after 7 days with too little database
  activity.** It can be resumed from the dashboard for up to 90 days after
  pausing, with data intact — this is not itself data loss, but it is an
  outage if it happens while nobody is looking, and this project was created
  2026-07-28 and (as of 2026-07-31) still has no scheduled traffic hitting it
  daily.

**Decision (2026-07-31, project owner):** stay on Free rather than upgrade to
Pro. The mitigation is a manual dump, run reliably rather than automatically —
see below. This trades a monthly cost for operator discipline, which is a
reasonable trade for a project whose entire real-data window is one day.

**Already true and worth noting:** the production database is not empty.
`raffle_entries` currently holds 5 real, verified rows (`is_test = false`) —
the maintainer's own dry-run entries from the prelaunch checklist, made with
real addresses before test mode existed or was used for that step. The Free
plan's lack of backups has been a live gap since 2026-07-28, not a
theoretical one that starts at the event.

## RPO / RTO

**Recommended, pending the project owner's sign-off:**

- **RPO (data that may be lost): effectively zero for the pool itself.** The
  real backstop is not the database backup — it is the CSV export taken the
  moment intake closes (see below), which is a second, independent copy of
  the only data that has to survive: the draw pool. A restore of the database
  itself, if it were ever needed, would lose at most the minutes since the
  last manual dump.
- **RTO (time to recover): under one hour.** The restore proof below took
  minutes end to end, and Free-plan `db dump` needs nothing but the CLI
  already authenticated on this machine — no dashboard access, no support
  ticket, no waiting on anyone else.

These numbers assume the manual dump procedure below is actually run at the
right moments. A backup nobody took is not a fast recovery, it is no
recovery.

## Restoring once, to prove it

Required by B3: "a backup that has never been restored is a belief, not a
backup." Done 2026-07-31.

**Target:** the org is already at its 2-project Free-tier cap (this project
plus an unrelated `LIVAPON_FullfillmentSystem`), so a second cloud project
was not available without pausing or upgrading something that has nothing to
do with this event. The local Supabase dev stack (`pnpm exec supabase db
reset`, migrations `0001`–`0010` applied fresh, Docker Postgres) served as
the scratch target instead — a genuinely separate database, reachable with
the same restore commands, without spending anything or touching an
unrelated project.

**Procedure:**

```bash
# One-time per machine.
pnpm exec supabase link --project-ref eyysljemlsghdxjaxjbn

# Schema. No database password needed — the CLI authenticates through the
# access token it already has, not a direct Postgres connection.
pnpm exec supabase db dump --linked -f schema.sql --yes

# Data. --use-copy is faster and is what was verified here; the schema dump
# and the data dump are two separate files on purpose, so a schema-only
# sanity check never has to touch a row of entrant data.
pnpm exec supabase db dump --linked --data-only --use-copy -f data.sql --yes

# Restore into the scratch target. Local example — for the equivalent
# against a scratch cloud project, swap the connection for that project's.
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 < data.sql
```

**Result:** every one of the 7 tables matched production exactly —
`campaigns` 1, `raffle_entries` 5, `verification_tokens` 5, `email_outbox` 5,
`email_deliveries` 10, `admin_audit_logs` 7, `rate_limit_buckets` 11 — and a
join from `raffle_entries` to `campaigns` on the restored data confirmed no
orphaned rows. `data.sql` (the file with real addresses in it) was deleted
immediately after; only this result, not the file, is meant to outlive the
test.

**What this proves and what it does not.** It proves the dump-and-restore
commands work against this schema, that `--linked` needs no secret beyond
what the CLI already has, and that the row counts survive exactly. It does
not prove a restore into a fresh **cloud** Supabase project — that path is
mechanically the same `psql < data.sql` step against a different connection
string, but was not exercised here because of the project cap above. Worth
doing once for real if the Free-plan decision is revisited.

## The manual backup procedure, for real use

Two moments matter. Both use the three commands above.

1. **The moment intake closes, before the draw.** This is B3's own
   requirement and is now also step 6a in
   [on-site-runbook.md](on-site-runbook.md): run the data dump (or the CSV
   export, which covers the same ground for the pool itself) immediately
   after **受付を終了**, before anything else happens. This is the copy that
   makes the draw pool survive a disaster in the minutes between closing and
   exporting.
2. **Once during the week before the event**, as a dry run of the commands
   themselves and to confirm the CLI is still linked and authenticated on
   whatever machine will be used on the day.

**Handling the output file.** `data.sql` contains real email addresses and,
for entrants who filled the optional fields, dates of birth. Keep it on the
operator's own machine, not in this repository, not in a chat upload, not in
any GitHub Actions artifact — this repository is **public**, and an artifact
on a public repository is downloadable by anyone signed in to GitHub, not
just collaborators. Delete it once it is no longer needed under the
retention decision in [readiness-gaps.md](readiness-gaps.md) P1.

**Making sure it actually happens.** A command that is easy to run is still
a command somebody has to remember to run, at a booth, during a festival.
This document does not solve that by itself — see the checklist item this
links back to in [readiness-gaps.md](readiness-gaps.md) B3 for the reminder
mechanism.
