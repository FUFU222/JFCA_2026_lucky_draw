# Staging

Staging exists to answer one question the live system cannot: **does it hold up
under load.** For the other question it used to answer — does the whole journey
work on real infrastructure — [test mode](on-site-runbook.md#checking-the-flow-mid-event-without-affecting-the-draw)
is now the better tool. It runs the real form, the real Resend mail and the real
database against production itself, while staying out of the counts, the export
and the draw.

## Read this before building a staging deployment

The safety guards are keyed on `NODE_ENV === 'production'`, and **every Vercel
deployment is a production build, Preview included.** So a Vercel Preview or a
second Vercel project configured the way this document used to describe —
`MAIL_DELIVERY_MODE=log` plus Cloudflare's test secret — will refuse to boot,
and if the mail mode were the only problem the captcha would still reject every
visitor (`lib/security/turnstile.ts` returns `false` for a test secret whenever
`NODE_ENV` is production).

That guard is doing its job: it is the same mechanism that stops this
configuration reaching real visitors. But it means staging cannot simply be
"production with the test credentials". Pick one:

- **For walking the journey — use test mode instead.** No second environment,
  no second Supabase project, and it exercises the real mail path.
- **For the load test — run the built app somewhere `NODE_ENV` is not
  production**, i.e. `pnpm build && pnpm start` on a machine you control,
  pointed at a separate Supabase project. This is the only supported way to get
  log mode and the always-pass captcha together.
- Deploying a staging environment on Vercel at all would need a deliberate
  escape hatch in `lib/config/startup.ts`. There is none today, on purpose — it
  would be a lever that silently swallows mail if it were ever set in
  production.

## What makes staging different

| Setting | Staging | Production |
| --- | --- | --- |
| `MAIL_DELIVERY_MODE` | `log` | `send` |
| `TURNSTILE_SECRET_KEY` | `1x0000000000000000000000000000000AA` | real secret |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `1x00000000000000000000AA` | real site key |
| `RAFFLE_IP_REQUEST_LIMIT` | `100000` while load testing | `100000` — see the checklist |
| Supabase project | separate project | `eyysljemlsghdxjaxjbn` |

The two Cloudflare values are Cloudflare's published always-pass test
credentials. `RESEND_API_KEY` is still required at startup even in log mode; any
non-empty value will do, since nothing reaches the provider.

In log mode the real templates are rendered and a successful delivery is
recorded, but nothing reaches a provider. The confirmation link is written to
the server log, which is how you walk the journey without a mailbox.

## Setting it up

1. Create a second Supabase project. Apply the schema the same way as
   production (`supabase link` then `supabase db push`), and run the campaign
   insert from [README.md](../../README.md).
2. In Supabase → Auth → URL configuration, add the staging
   `https://<staging-host>/auth/callback`.
3. Build and run the app somewhere `NODE_ENV` is not `production` — see the
   warning above — with every variable from the pre-launch checklist and the
   staging values above substituted. Staging also needs its own Supabase Auth
   SMTP and rate-limit settings if you intend to sign in to its admin screens.
4. Open the campaign so the form renders:

   ```sql
   update public.campaigns
   set status = 'SCHEDULED',
       opens_at = now() - interval '1 hour',
       draw_starts_at = now() + interval '7 days'
   where slug = 'jfca-2026';
   ```

## Walking the journey on staging

1. Open `https://<staging-host>/jfca-2026` on a phone, not a desktop browser.
2. Submit an address you control. The confirmation dialog must repeat it.
3. Find the link in the Vercel runtime logs — the line starts `[mail:log]`.
4. Open it, confirm, and check the number page renders.
5. Open the same link again. It must say the link cannot be used.
6. Sign in at `/admin/login` and check the entry appears, then export the CSV
   and open it in Excel.

## Load test — not run for this event, and why that is a reasoned call

The HTTP-level run below still works as documented, but for this event it was
judged unnecessary rather than skipped for lack of time. Written down so a
later reader does not mistake "not run" for "forgotten":

- The property a load test would prove — no duplicate numbers — is a
  structural guarantee, not an empirical one. Numbers are issued inside
  `confirm_raffle_verification`, which locks the campaign row with
  `select ... for update` before incrementing the counter. Postgres serialises
  writers to that row regardless of how many arrive at once; that does not
  become more true by sampling it at N=100 rather than N=2.
- That guarantee is exercised directly instead.
  **`tests/integration/raffle-repository.test.ts`** has "issues N distinct
  sequential numbers to N distinct entrants confirming at once, with no
  duplicates" — 80 concurrent confirmations, asserting the result is exactly
  `{10000, ..., 10000+79}` with no gaps or repeats. It runs against the same
  local Supabase the rest of the suite uses, so it costs nothing and needs no
  infrastructure. 80 concurrent confirmations completed in 185ms in one run —
  not a benchmark, but evidence the lock is not visibly stalling.
- What an HTTP-level run adds on top is *latency and infra-limit* coverage —
  Vercel concurrency, Supabase's connection pool — under a rate this event
  will not produce. 30,000 entrants over seven hours, with the receipt email
  removed, averages under 5 req/s; even a generous 3-4x arrival peak stays in
  the single digits. 100 req/s sustained for 30 seconds was written into the
  original plan as a generic acceptance target, not calibrated to this
  event's actual ceiling.
- Setting it up also meant standing up a second cloud Supabase project, which
  the organisation's Free-tier 2-project limit refused outright (confirmed
  2026-07-30). Working around that meant pausing another live project or
  paying for a Pro-tier project for a single test run — real cost and real
  disruption elsewhere, for a question the concurrency test above already
  answers for the one property that matters.

If a future event's expected volume is materially larger — sustained tens of
requests per second rather than single digits — redo this calculation rather
than assuming it still holds, and run the test below.

The acceptance target is 100 verification requests per second sustained, with no
server errors, no duplicate numbers, and a controlled 429 for traffic over the
limit.

```bash
# Raise the per-IP allowance first, or the run measures the limiter rather than
# the system. Set RAFFLE_IP_REQUEST_LIMIT=100000 in Vercel and redeploy.
pnpm load-test --url https://<staging-host> --rate 100 --seconds 30
```

The script refuses to run against the production hostname.

Afterwards, in the staging database:

```sql
-- Must return no rows.
select number, count(*)
from raffle_entries
where campaign_id = (select id from campaigns where slug = 'jfca-2026')
  and number is not null
group by number having count(*) > 1;

-- Clean up.
delete from raffle_entries where email like 'load-%@example.invalid';
```

Then put `RAFFLE_IP_REQUEST_LIMIT` back to its normal staging value.

## Read-only checks against any deployed origin

Safe to run against staging or production, immediately after a deploy. It
creates nothing.

```bash
SMOKE_BASE_URL=https://<host> pnpm test:e2e production-smoke
```

`SMOKE_BASE_URL` also stops Playwright starting a local server. If the origin
serves a slug other than `jfca-2026`, set `SMOKE_EVENT_SLUG` too.
