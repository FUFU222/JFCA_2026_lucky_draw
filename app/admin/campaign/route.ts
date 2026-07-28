import { NextResponse } from 'next/server';

import { recordAudit } from '../../../lib/admin/audit';
import { loadDashboard, setCampaignStatus } from '../../../lib/admin/queries';
import { ACTIVE_CAMPAIGN_SLUG } from '../../../lib/campaign/config';
import { getOperatorSession } from '../../../lib/security/operator-session';

export const dynamic = 'force-dynamic';

/**
 * Pause and resume only. Numbers are never edited or reissued here, and the
 * public service reads `campaigns.status` on every write, so a pause takes
 * effect on the next submission rather than at some cache boundary.
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

  if (body.action !== 'PAUSE' && body.action !== 'RESUME') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const eventSlug = typeof body.event === 'string' ? body.event : ACTIVE_CAMPAIGN_SLUG;
  const dashboard = await loadDashboard(eventSlug);
  if (!dashboard) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const status = body.action === 'PAUSE' ? 'PAUSED' : 'SCHEDULED';
  await setCampaignStatus(dashboard.campaign.id, status);
  await recordAudit({
    action: body.action === 'PAUSE' ? 'PAUSE_REGISTRATION' : 'RESUME_REGISTRATION',
    actorId: operator.userId,
    actorEmail: operator.email,
    campaignId: dashboard.campaign.id,
    metadata: { event_slug: eventSlug, previous_status: dashboard.campaign.status },
  });

  return NextResponse.json({ ok: true, status });
}
