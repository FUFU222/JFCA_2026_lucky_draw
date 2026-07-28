#!/usr/bin/env node
/**
 * Registration load test.
 *
 * Run this against **staging only**. Staging is configured with
 * `MAIL_DELIVERY_MODE=log` and Cloudflare's always-pass Turnstile test secret,
 * so no real message is sent and the challenge is not in the way. Production
 * refuses both settings at startup, so pointing this at production would simply
 * fail the captcha rather than flood anyone.
 *
 *   node scripts/load-test.mjs --url https://staging.example.com \
 *     --event jfca-2026 --rate 100 --seconds 30
 *
 * Acceptance, from the implementation plan: at least 100 verification requests
 * per second sustained, no duplicate numbers, no database connection failures,
 * and a controlled response for traffic that is rate limited.
 */

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index].replace(/^--/, ''), process.argv[index + 1]);
}

const baseUrl = (args.get('url') ?? '').replace(/\/+$/, '');
const eventSlug = args.get('event') ?? 'jfca-2026';
const rate = Number(args.get('rate') ?? 100);
const seconds = Number(args.get('seconds') ?? 30);

if (!baseUrl) {
  console.error('Usage: node scripts/load-test.mjs --url <staging-url> [--event slug] [--rate n] [--seconds n]');
  process.exit(2);
}
if (/luckydraw\.livapon\.com/.test(baseUrl)) {
  console.error('Refusing to run against the production hostname.');
  process.exit(2);
}

const endpoint = `${baseUrl}/api/campaigns/${eventSlug}/entries`;
const statuses = new Map();
const latencies = [];
let networkErrors = 0;

function record(status, ms) {
  statuses.set(status, (statuses.get(status) ?? 0) + 1);
  latencies.push(ms);
}

async function submit(index) {
  const started = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Spread the per-IP allowance the way a crowd would. Whether this has
        // any effect depends on the edge: if it overwrites the header, every
        // request shares one bucket and the run measures the limiter instead of
        // throughput. Raise RAFFLE_IP_REQUEST_LIMIT on staging in that case.
        'x-forwarded-for': `203.0.113.${index % 254}`,
      },
      body: JSON.stringify({
        email: `load-${Date.now()}-${index}@example.invalid`,
        terms_consent: true,
        locale: index % 2 === 0 ? 'en' : 'ja',
        country: 'CA',
        turnstile_token: 'load-test-token',
      }),
    });
    record(response.status, performance.now() - started);
  } catch {
    networkErrors += 1;
  }
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

console.info('POST %s at %d/s for %ds', endpoint, rate, seconds);

const inFlight = [];
const startedAt = Date.now();
for (let tick = 0; tick < seconds; tick += 1) {
  const tickStart = Date.now();
  for (let index = 0; index < rate; index += 1) {
    inFlight.push(submit(tick * rate + index));
  }
  const elapsed = Date.now() - tickStart;
  if (elapsed < 1000) await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
}
await Promise.all(inFlight);

const totalSeconds = (Date.now() - startedAt) / 1000;
const sorted = [...latencies].sort((a, b) => a - b);
const accepted = statuses.get(202) ?? 0;
const limited = statuses.get(429) ?? 0;
const serverErrors = [...statuses.entries()]
  .filter(([status]) => status >= 500)
  .reduce((total, [, count]) => total + count, 0);

console.info('\nrequests      %d in %ss (%s/s)', latencies.length, totalSeconds.toFixed(1), (latencies.length / totalSeconds).toFixed(1));
console.info('statuses      %o', Object.fromEntries([...statuses.entries()].sort()));
console.info('accepted      %d', accepted);
console.info('rate limited  %d (a controlled 429 is a pass, not a failure)', limited);
console.info('server errors %d', serverErrors);
console.info('network fails %d', networkErrors);
console.info('latency ms    p50 %d  p95 %d  p99 %d', percentile(sorted, 0.5) | 0, percentile(sorted, 0.95) | 0, percentile(sorted, 0.99) | 0);

console.info(
  '\nNow confirm in the staging database that no number was issued twice:\n' +
    '  select number, count(*) from raffle_entries\n' +
    "  where campaign_id = (select id from campaigns where slug = '" + eventSlug + "')\n" +
    '    and number is not null group by number having count(*) > 1;\n' +
    'It must return no rows. Then delete the load-test entries:\n' +
    "  delete from raffle_entries where email like 'load-%@example.invalid';",
);

process.exit(serverErrors > 0 || networkErrors > 0 ? 1 : 0);
