import { NextResponse } from 'next/server';

import { ACTIVE_CAMPAIGN_SLUG } from '../../../lib/campaign/config';
import { collectHealth, evaluateHealth, outboxBacklogThreshold } from '../../../lib/observability/health';
import { hasCronSecret } from '../../../lib/security/cron-auth';
import { clientIpAddress } from '../campaigns/_shared';

/**
 * The endpoint an external monitor polls. See docs/operations/monitoring.md for
 * what to point at it.
 *
 * Unauthenticated on purpose: the free tier of every uptime service can send a
 * GET and match a keyword, and few of them can send a header. So the public
 * body carries no numbers and no personal data — only the words a monitor needs
 * to match on. The numbers an operator wants during the event are behind
 * `Authorization: Bearer ${CRON_SECRET}`.
 *
 * The HTTP status is the coarse signal and means one thing: 503 if a visitor
 * could not complete an entry right now. Everything else is 200 with a
 * `status` word in the body, because an alarm that fires on a normal state gets
 * muted long before the day it matters.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const authorized = hasCronSecret(request);

  // An anonymous caller always gets the active campaign, whatever they ask for.
  // Honouring `?event=` for everyone would turn this into a way to find out
  // which slugs exist — a rehearsal campaign answers differently from a
  // fictional one — and would let a request for any other campaign land in the
  // cache the monitor watching this one reads from.
  const requested = new URL(request.url).searchParams.get('event');
  const slug = authorized && requested ? requested : ACTIVE_CAMPAIGN_SLUG;

  let snapshot: Awaited<ReturnType<typeof collectHealth>>;
  try {
    snapshot = await collectHealth(slug);
  } catch (error) {
    // A health check that throws is a health check that reports nothing, which
    // is the one outcome worse than reporting bad news.
    const { reportServerError } = await import('../../../lib/observability/report');
    await reportServerError(error, { route: 'GET /api/health' });
    return NextResponse.json(
      { status: 'down', database: 'unknown', reason: 'health check failed' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const verdict = evaluateHealth(snapshot, outboxBacklogThreshold());

  const body: Record<string, unknown> = {
    status: verdict.status,
    database: snapshot.database.ok ? 'ok' : 'down',
    outbox: snapshot.outboxWaiting === null ? 'unknown' : verdict.status === 'ok' ? 'ok' : 'behind',
    // Named as a plain word so a keyword monitor can match `"accepting":true`
    // for the length of the event and nothing else has to be configured.
    accepting: snapshot.campaign.accepting,
  };

  if (authorized) {
    body.detail = {
      event: slug,
      campaignStatus: snapshot.campaign.status,
      campaignFound: snapshot.campaign.found,
      databaseLatencyMs: snapshot.database.latencyMs,
      databaseError: snapshot.database.error,
      outboxWaiting: snapshot.outboxWaiting,
      outboxBacklogThreshold: outboxBacklogThreshold(),
      // So "we added alerting" and "alerting is switched on in this deployment"
      // cannot be confused for each other, which is how monitoring usually
      // fails: installed, never configured, nobody notices until it is needed.
      errorAlerts: snapshot.errorTrackingEnabled ? 'on' : 'off',
      reasons: verdict.reasons,
      // TEMPORARY — readiness-gaps.md R3 / issue #3: confirms whether Vercel
      // overwrites x-real-ip / x-forwarded-for on ingress, by showing what the
      // rate limiter would actually key on for this request. Revert once
      // that's verified; it does not belong in the endpoint long-term.
      resolvedClientIp: clientIpAddress(request),
    };
  }

  return NextResponse.json(body, {
    status: verdict.httpStatus,
    headers: { 'cache-control': 'no-store' },
  });
}
