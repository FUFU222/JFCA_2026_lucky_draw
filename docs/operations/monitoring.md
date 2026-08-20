# Monitoring

Until this document existed, the only thing that noticed a fault was a person
looking at the dashboard. That works at a desk and not at a festival booth,
which is the one place it has to.

Five layers, each covering what the others cannot:

| Layer | Notices | Latency | Needs configuring |
| --- | --- | --- | --- |
| Structured error log | every unhandled server error | after the fact | nothing |
| Alert webhook | the same errors, pushed to a phone | seconds | `ALERT_WEBHOOK_URL` |
| Client-side error reporting | a fault in a visitor's own browser, before any request is sent | seconds | nothing (always on) |
| External monitor on `/api/health` | the deployment or the database being unreachable | one polling interval | an account at a monitoring service |
| Scheduled `Production smoke` workflow | a page or an auth gate that broke | best-effort, hourly at most | nothing (uses `APP_URL`) |

The structured log, client-side reporting and the scheduled smoke workflow
need nothing to configure. **The alert webhook and the external monitor are
the two that had to be switched on deliberately** — both were, confirmed
live against production on 2026-08-03 (see
[readiness-gaps.md](readiness-gaps.md) B5). The steps below are what was
done and are kept as the reference for redoing it — after a Vercel
environment reset, a project migration, or reusing this code for a future
event — not as an outstanding task.

## 1. The error log

Every unhandled server-side error reaches Next.js's `onRequestError` hook in
[instrumentation.ts](../../instrumentation.ts) and is written as one line:

```
[error] {"name":"PostgrestError","message":"…","route":"POST /api/campaigns/[eventSlug]/entries","fingerprint":"…"}
```

Search `[error]` in the Vercel log viewer. One line per occurrence, one JSON
object, so it can be filtered and counted.

Two things are deliberately true of that line:

- **It never contains an email address or a token.** Messages pass through
  redaction first ([lib/observability/alerts.ts](../../lib/observability/alerts.ts)),
  which strips addresses, known key shapes, `Bearer` values and anything long
  enough to be a hash. Entry UUIDs survive on purpose — they are what makes an
  alert actionable and identify nobody without database access.
- **It reports the route, not the URL.** A receipt URL is a bearer token; logging
  one would put a permanent credential in a log aggregator.

## 2. The alert webhook

The log answers "what happened" afterwards. This answers "something is happening
now", which is the question that matters during the event.

1. Create an incoming webhook in whichever channel the operator already has open
   on their phone:
   - **Slack** — Apps → Incoming Webhooks → Add to a channel.
   - **Discord** — Server Settings → Integrations → Webhooks → New Webhook.
   - **Google Chat** — the space's Apps & integrations → Webhooks.
2. In Vercel → Settings → Environment Variables, add `ALERT_WEBHOOK_URL` for
   Production with the URL, and redeploy.
3. Confirm it is live: `curl -s -H "Authorization: Bearer $CRON_SECRET" \
   "$APP_URL/api/health" | jq .detail.errorAlerts` must print `"on"`. Set but
   not deployed reads `"off"`, which is the failure this check exists to catch.

The payload carries both `text` and `content`, which is what makes one URL work
for all three services without a code change.

**Alerts are throttled**: one per distinct fault per five minutes, at most 20 an
hour per running instance for a server-side fault, and the next one that gets
through says how many were suppressed. A channel that shows a single line for
a hundred failures reads as a one-off, which is worse than silence.

**Client-reported faults draw from their own, smaller hourly budget (10, not
20)** — see the next section — rather than sharing the server-side one. The
client-error endpoint has to stay unauthenticated, since a visitor's browser
has no credential to present, so a flood of fabricated reports against it is
always possible; a shared budget would let that flood spend the whole hourly
allowance and silently suppress a genuine server-side alert for the rest of
the window. Separating the two means the worst a hostile or misbehaving
client can do is drown out other client errors, never a server one.

Faults are grouped after redaction and with digits normalised, so a hundred
visitors hitting one broken path produce one alert rather than a hundred.

## 3. Client-side error reporting

A server-side fault is caught no matter where it happens, by layer 1 above.
A fault in a visitor's own browser — before any request is even sent to the
server, such as a script crashing while the entry form renders — used to be
invisible.
[components/observability/client-error-reporter.tsx](../../components/observability/client-error-reporter.tsx)
is mounted once, in the root layout, and subscribes to `window.onerror` and
`unhandledrejection`. It filters out one specific kind of noise before
sending anything: a script error whose source is not this application's own
origin — a browser extension, or a script injected by the LINE/Instagram
in-app browsers many visitors will actually be using — carries nothing
actionable, so it is dropped at the source rather than reported.

What survives the filter is POSTed to `/api/client-error`, which is public
like `/api/health`'s `GET` and rate-limited per IP through the same
Supabase-backed limiter the raffle form itself uses. From there it goes
through the identical `reportServerError()` path every server-side fault
uses — same structured log line, same Slack/Discord/Google Chat webhook,
same redaction — under the `client:`-prefixed route and the separate budget
described above. A verification or receipt link carries its bearer token in
the URL *path itself*, not a query string, so the path a visitor's browser
reports is redacted the same way an error message is before it can reach a
chat channel.

This layer has one acknowledged gap: `unhandledrejection` carries no
filename, so there is no way to apply the same origin filter to it that
`window.onerror` gets. A rejection from a third-party script running in the
page (Cloudflare Turnstile's own code, for instance) would be reported like
a first-party one. The separate, smaller client budget above is what bounds
the resulting noise rather than a filter removing it.

## 4. The external monitor

This is the only layer that notices the deployment being **gone**, because
nothing inside a dead deployment can report on it.

`GET /api/health` is unauthenticated so that a free monitoring tier can reach
it. The public body carries no counts and no personal data:

```json
{"status":"ok","database":"ok","outbox":"ok","accepting":true}
```

- **HTTP 503** means a visitor could not complete an entry right now: the
  database is unreachable, or the campaign row is missing. Nothing else returns
  503.
- **`status`** is `ok`, `degraded` or `down`. `degraded` still returns 200 — it
  is mail piling up, not an outage.
- **`accepting`** reflects whether intake is open. It never affects the status,
  because for all but a few hours of this system's life it is legitimately
  `false`, and an alarm that fires on a normal state gets muted long before the
  day it is needed.

### Setting it up

**Done — all three created on UptimeRobot's free tier, confirmed against
production 2026-08-03.** Kept below as the reference for redoing this, not
as an open task. Any service that polls an HTTP endpoint, matches a keyword,
and can push to a phone will do; UptimeRobot needs no card and does keyword
monitoring. Verify the polling interval it gives you on signup — five
minutes or better is the requirement here.

- [x] **Monitor 1, always on.** `GET https://luckydraw.livapon.com/api/health`,
      alert on a non-2xx response. This is the outage alarm.
- [x] **Monitor 2, always on.** Same URL, keyword monitor, alert when the body
      stops containing `"status":"ok"`. This is what surfaces a `degraded`
      deployment — mail queued and not moving — which monitor 1 cannot see.
- [x] **Monitor 3, event day only — created, correctly left paused.** Same
      URL, keyword monitor on
      `"accepting":true`. Switch it on when intake opens and off when it closes.
      It is the answer to the worst silent failure available to this system: a
      stray tap that pauses or closes intake, with the booth carrying on
      unaware. **Remember to switch it off**, or it alarms all night.
- [ ] Point the alerts at a phone that will be at the venue, not only at email.

When an alert fires, the operational response is already written down: for a
queue that will not drain see the outbox section of
[on-site-runbook.md](on-site-runbook.md), and for "Too many attempts" reports
see the venue-network section of the same document.

### Reading the detail

With the cron credential, the same endpoint returns the numbers:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://luckydraw.livapon.com/api/health" | jq .
```

```json
{
  "status": "ok",
  "detail": {
    "campaignStatus": "SCHEDULED",
    "databaseLatencyMs": 38,
    "outboxWaiting": 3,
    "outboxBacklogThreshold": 50,
    "errorAlerts": "on"
  }
}
```

`outboxWaiting` is scoped exactly like the dashboard's 送信待ちメール数 gauge —
this campaign's real entries only, so an operator's test-mode rehearsals never
raise the alarm. `OUTBOX_BACKLOG_THRESHOLD` moves the line at which it reads
`degraded`; the default is 50.

The endpoint caches its snapshot for ten seconds, so an unauthenticated URL that
anyone can poll cannot be turned into database load.

## 5. The scheduled smoke workflow

`.github/workflows/production-smoke.yml` drives a real browser against
production: the entry page renders, the terms resolve, an unusable link says so,
`/admin` refuses an anonymous caller, the outbox endpoint 401s without its
credential. It creates nothing, so it is safe during the event.

It uses the `APP_URL` repository secret that the outbox worker already needs, so
there is nothing new to add.

**Treat the schedule as eventual.** Measured on this repository, a `*/5` cron
really ran about every 88 minutes. This is depth, not latency — the external
monitor above is the alarm. Run it by hand from the Actions tab after every
deploy and before doors open.

## What this deliberately does not cover

- **There is no error-grouping dashboard.** `@sentry/nextjs` was the intended
  answer and could not be installed on 2026-07-30: it pulls `webpack@5.109.2`,
  which depends on `enhanced-resolve@^5.24.4`, a version that is not published.
  Unblocking it means pinning webpack through a pnpm override — a change to the
  build two weeks before a one-shot event, for a dashboard nobody would be
  watching at the booth anyway. Revisit after the event, or before this code is
  reused. See [readiness-gaps.md](readiness-gaps.md).
- **Uptime history and status pages** are whatever the monitoring service keeps.
  Nothing here stores it.
