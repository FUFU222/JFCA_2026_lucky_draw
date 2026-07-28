import { NextResponse } from 'next/server';

import type { AuditAction } from '../../../lib/admin/audit';
import { recordAudit } from '../../../lib/admin/audit';
import { loadDashboard, setCampaignStatus, startRegistrationNow } from '../../../lib/admin/queries';
import { ACTIVE_CAMPAIGN_SLUG } from '../../../lib/campaign/config';
import { getOperatorSession } from '../../../lib/security/operator-session';

export const dynamic = 'force-dynamic';

type Action = 'PAUSE' | 'RESUME' | 'START' | 'CLOSE';

const AUDIT_ACTION: Record<Action, AuditAction> = {
  PAUSE: 'PAUSE_REGISTRATION',
  RESUME: 'RESUME_REGISTRATION',
  START: 'START_REGISTRATION',
  CLOSE: 'CLOSE_REGISTRATION',
};

/**
 * Numbers are never edited or reissued here, and the public service reads
 * `campaigns.status` on every write, so any of these actions takes effect on
 * the next submission rather than at some cache boundary.
 */
export async function POST(request: Request) {
  const operator = await getOperatorSession();
  if (!operator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { action?: unknown; event?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'PAUSE' && action !== 'RESUME' && action !== 'START' && action !== 'CLOSE') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const eventSlug = typeof body.event === 'string' ? body.event : ACTIVE_CAMPAIGN_SLUG;
  const dashboard = await loadDashboard(eventSlug);
  if (!dashboard) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Starting without a draw time would silently do nothing: `isRegistrationOpen()`
  // requires `draw_starts_at` regardless of `status`, so the operator would see
  // "started" here and "not open yet" on the public page with no way to tell why.
  if (action === 'START' && dashboard.campaign.draw_starts_at === null) {
    return NextResponse.json({ error: 'draw_time_not_set' }, { status: 409 });
  }

  let status: 'PAUSED' | 'CLOSED' | 'SCHEDULED';
  if (action === 'PAUSE') {
    status = 'PAUSED';
    await setCampaignStatus(dashboard.campaign.id, status);
  } else if (action === 'CLOSE') {
    status = 'CLOSED';
    await setCampaignStatus(dashboard.campaign.id, status);
  } else if (action === 'START') {
    status = 'SCHEDULED';
    await startRegistrationNow(dashboard.campaign.id, dashboard.campaign.opens_at);
  } else {
    status = 'SCHEDULED';
    await setCampaignStatus(dashboard.campaign.id, status);
  }

  await recordAudit({
    action: AUDIT_ACTION[action],
    actorId: operator.userId,
    actorEmail: operator.email,
    campaignId: dashboard.campaign.id,
    metadata: { event_slug: eventSlug, previous_status: dashboard.campaign.status },
  });

  return NextResponse.json({ ok: true, status });
}
