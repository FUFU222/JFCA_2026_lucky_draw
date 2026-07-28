# Staging

Staging exists to answer two questions before the event: does the whole journey
work on real infrastructure, and does it hold up under load. It is deliberately
configured so that **no real message can be sent and no real visitor can be
affected**.

## What makes staging different from production

| Setting | Staging | Production |
| --- | --- | --- |
| `MAIL_DELIVERY_MODE` | `log` | `send` |
| `TURNSTILE_SECRET_KEY` | `1x0000000000000000000000000000000AA` | real secret |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `1x00000000000000000000AA` | real site key |
| `RAFFLE_IP_REQUEST_LIMIT` | `100000` while load testing | leave at the default |
| Supabase project | separate project | production project |

The two Cloudflare values are Cloudflare's published always-pass test
credentials. The application **refuses to start in production** with either of
them, or with `MAIL_DELIVERY_MODE=log`, so this configuration cannot leak into
production by accident — a mistake becomes a failed deploy, not a silent one.

In log mode the real templates are rendered and a successful delivery is
recorded, but nothing reaches a provider. The confirmation link is written to
the server log, which is how you walk the journey on staging without a mailbox.

## Setting it up

1. Create a second Supabase project. Apply the schema the same way as
   production (`supabase link` then `supabase db push`), and run the campaign
   insert from [README.md](../../README.md).
2. In Supabase → Auth → URL configuration, add the staging
   `https://<staging-host>/auth/callback`.
3. Create a Vercel Preview or a second project pointing at the same repository.
   Set every variable from the pre-launch checklist, with the staging values
   above substituted.
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
6. Switch to Japanese and repeat. Both languages must be complete.
7. Sign in at `/admin/login` and check the entry appears, then export the CSV
   and open it in Excel.

## Load test

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
SMOKE_BASE_URL=https://<host> pnpm test:e2e -- production-smoke
```
