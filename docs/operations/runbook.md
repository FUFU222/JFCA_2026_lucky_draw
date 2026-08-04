# Operations runbook

For the maintainer, not the booth operator — that person has
[on-site-runbook.md](on-site-runbook.md). This one is the engineering side:
how a change actually reaches production, how to roll one back, how to rotate
a secret without losing it, and what to do when an alert fires.

## Shipping a change

Every change to this repository follows the same pipeline, in order. Skipping
a step is how a mistake reaches 30,000 visitors instead of a code review.

1. **Local checks, all four, before anything else:**
   ```bash
   pnpm test && pnpm typecheck && pnpm lint && pnpm build
   ```
   `pnpm build` matters on its own: it regenerates `.next/types`, and a route
   deleted since the last build leaves a stale type reference that only
   `tsc --noEmit` against a fresh build catches.
2. **Commit, push, open a PR.** Never push to `main` directly.
3. **Code review**, even for a solo-maintained repository — there is no
   second engineer, so the review has to come from somewhere else. Describe
   what changed and why in the PR body; a reviewer with no other context
   should be able to judge it from that alone.
4. **Wait for CI** (`.github/workflows/ci.yml` — lint, typecheck, the unit and
   integration suites, `pnpm audit`, a production build). A failure unrelated
   to the change (a transient GitHub API error, a dependency advisory that
   showed up on an unrelated PR) still has to be understood before being
   dismissed — see [staging.md](staging.md) and this file's own history for
   what "actually unrelated" has looked like before. When it is a dependency
   advisory, the fix is almost always a version bump under `overrides:` in
   `pnpm-workspace.yaml` — that file, not `package.json`'s `pnpm.overrides`,
   is what pnpm 11 reads.
5. **Merge.**
6. **Deploy**, from a working tree whose content matches `main` exactly
   (`git diff origin/main HEAD --stat` should print nothing):
   ```bash
   vercel --prod --yes
   ```
   Confirm `.vercel/project.json` reads
   `{"projectId":"prj_ntZYcoobYjXyHlH8btzVvsw8UdXz","orgId":"team_DVloD1usxqCQ6758aFB6nTp2","projectName":"jfca-2026-lucky-draw"}`
   before running this. A missing or wrong project link creates a *new*
   Vercel project on the first deploy instead of releasing to the real one —
   it happens silently and the command still reports success.
7. **Verify against the live URL**, not the deploy command's own "ready"
   output:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://luckydraw.livapon.com/api/health
   ```
   A merge is not the finish line here; a 200 from production is. If the
   change touched a specific route, curl that route too.

**Never commit a temporary debugging endpoint.** If one is needed to prove
something end-to-end against production (see the CRON_SECRET section below
for why that sometimes happens), deploy it with `vercel --prod --yes` while
it is uncommitted, confirm it, then delete the file and redeploy the clean
committed tree in the same sitting — not "later."

## Rolling back

Vercel can revert to the immediately preceding production deployment in
seconds:

```bash
vercel rollback <deployment-url> --yes
```

Run with no argument, it reports whether a rollback is already in progress.
This project is on Vercel's **Hobby** plan, which only exposes
`isRollbackCandidate: true` for the current production deployment and the
one right before it — never anything older
(`vercel deploy --prod` history shown via `list_deployments`). Rolling back
two or more deploys fails with `402 upgrade to pro`.

That is why the **code freeze** matters more than it would on a plan without
this limit: after **D-2 (2026-08-13 for the 2026-08-15 event)**, nothing
ships except a fix for something a rehearsal actually found. With at most one
deploy landing in that window, "roll back" always means "back to the last
known-good state" — never "which of the last several was it." See
[readiness-gaps.md](readiness-gaps.md) B6/B6a for the full reasoning and the
confirmation this was exercised for real.

## Rotating a secret

`CRON_SECRET` is the credential the outbox retry worker
(`.github/workflows/email-outbox.yml`) and the authenticated branch of
`/api/health` both check, in constant time, via
[lib/security/cron-auth.ts](../../lib/security/cron-auth.ts). It has to be
identical in two places at once: the Vercel environment variable and the
GitHub Actions repository secret of the same name. This procedure applies to
any secret with that shape.

**Before rotating anything, save the new value to a password manager.** This
is the step that was skipped the first time this was done for real, which is
why it had to be done twice. A secret stored in Vercel as **Sensitive** —
which `CRON_SECRET` is — cannot be read back afterwards by anyone, through
any interface: not the dashboard, not `vercel env pull`, not the API. That is
a platform guarantee, not a permissions gap. Losing the only copy means a
second rotation, not a recovery.

1. Generate the new value and write it down somewhere retrievable, first.
2. Update Vercel:
   ```bash
   vercel env rm CRON_SECRET production --yes
   printf '%s' "$NEW_SECRET" | vercel env add CRON_SECRET production
   ```
   Run these as two separate commands. A single pasted multi-line block has
   corrupted itself before (a stray character split `vercel` into three
   unrecognised commands mid-paste, silently skipping the `add` step while
   `rm` and the GitHub side both succeeded) — the failure mode is quiet:
   nothing errors loudly, the two systems are just left disagreeing.
3. Update the matching GitHub Actions secret:
   ```bash
   gh secret set CRON_SECRET --body "$NEW_SECRET" --repo FUFU222/JFCA_2026_lucky_draw
   ```
4. Redeploy (`vercel --prod --yes`), so the running instance actually has the
   new value — an environment variable change alone does not touch a
   deployment already serving traffic.
5. **Confirm both sides agree**, against the live system:
   ```bash
   curl -s -H "Authorization: Bearer $NEW_SECRET" \
     "https://luckydraw.livapon.com/api/health" | jq .detail.errorAlerts
   ```
   A `401` here means Vercel's side did not take. Then confirm the GitHub
   side independently — `workflow_dispatch` the outbox worker by hand from
   the Actions tab and check the run is green, rather than waiting for its
   own schedule (which runs on a real median of about 88 minutes, not the
   5 minutes it asks for).
6. If either check fails, re-run only the one command that corresponds to the
   side that is wrong — do not repeat the whole sequence from a paste.

## When an alert arrives

An alert in the configured Slack (or Discord/Google Chat) channel reads:

```
【Lucky Draw】エラー発生 — <route> (<name>)
<the raw error message, in whatever language the library threw it in>
(同様のエラーがあと<N>件抑制されました)
<https://luckydraw.livapon.com>
```

The frame is in Japanese; the error message itself is left exactly as thrown
— almost always an English string from Supabase, Resend, or Node's own
`fetch` — since there is no reliable way to translate arbitrary library text.

1. **Read the route.** A `POST /api/campaigns/…` route is a real request that
   failed for a real visitor. A route beginning `client:` is a fault reported
   by a *visitor's browser*, not the server — see
   [monitoring.md](monitoring.md) for what that layer does and does not
   catch. The two draw from separate hourly budgets on purpose, so a flood of
   one kind can never silently swallow an alert of the other.
2. **Check `/api/health`** with the cron credential for the current picture —
   database latency, outbox depth, whether errors are still being suppressed:
   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" \
     "https://luckydraw.livapon.com/api/health" | jq .
   ```
3. **Find the full detail in the Vercel log viewer**, searching `[error]` —
   the alert is one line; the log entry carries the same fingerprint plus a
   redacted stack trace.
4. **If it is happening to visitors right now**, the on-site response (what
   to tell the booth, whether to keep scanning people through) is
   [on-site-runbook.md](on-site-runbook.md#the-system-is-down-not-just-the-venue-network),
   not this document — that one is written for whoever is standing at the
   booth, not for whoever is looking at a log.
5. **If the fault is new** (not one of the accepted risks already recorded),
   decide whether it needs a same-day fix or can wait. Before the freeze date
   this follows the normal [shipping pipeline](#shipping-a-change) above;
   after it, only a fix for something a rehearsal or the event itself
   actually found should ship at all.

## Routine checks, not tied to an alert

Nothing here pages anyone — they are worth a look periodically, especially in
the run-up to the event and on the day itself.

- **Resend → Settings → Usage.** Message volume against the plan quota, and
  the daily limit if one is set. See
  [prelaunch-checklist.md](prelaunch-checklist.md) §2 for the reasoning
  behind the current numbers.
- **GitHub Actions → `Email outbox retry worker`.** Recent runs, and whether
  any went red — a red run almost always means `APP_URL` or `CRON_SECRET` no
  longer matches between Vercel and the repository secret.
- **GitHub Actions → `Production smoke`.** Confirms the deployed origin still
  answers correctly on the paths a real visitor uses, without creating
  anything.
- **The three UptimeRobot monitors**, described in
  [monitoring.md](monitoring.md) §4 — in particular, that the event-day
  `"accepting":true` monitor is paused outside the hours intake is actually
  open, or it alarms all night for a normal closed state.
- **Open GitHub issues** (`gh issue list`) against
  [readiness-gaps.md](readiness-gaps.md)'s Accepted Risks table — the two
  should always agree on what is still open versus decided-and-accepted.

## Cleaning up after yourself

- Delete a git worktree and its branch once the work in it has shipped and
  merged. A stray worktree left behind is what causes a later session to
  guess wrong about which one is current.
- Any credential or plan raised specifically for the event (the Resend rate
  limit, the Resend Pro plan itself) gets cancelled by the date recorded in
  [on-site-runbook.md](on-site-runbook.md#after-the-event) — that section
  owns the teardown list, not this one.
