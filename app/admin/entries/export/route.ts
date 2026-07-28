import { NextResponse } from 'next/server';

import { recordAudit } from '../../../../lib/admin/audit';
import { entriesToCsv } from '../../../../lib/admin/csv';
import { exportEntries, loadDashboard } from '../../../../lib/admin/queries';
import { ACTIVE_CAMPAIGN_SLUG } from '../../../../lib/campaign/config';
import { getOperatorSession } from '../../../../lib/security/operator-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const operator = await getOperatorSession();
  if (!operator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const eventSlug = new URL(request.url).searchParams.get('event') ?? ACTIVE_CAMPAIGN_SLUG;
  const dashboard = await loadDashboard(eventSlug);
  if (!dashboard) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const entries = await exportEntries(dashboard.campaign.id);

  // The record says who exported what and how much — never the rows themselves.
  await recordAudit({
    action: 'EXPORT_CSV',
    actorId: operator.userId,
    actorEmail: operator.email,
    campaignId: dashboard.campaign.id,
    metadata: { event_slug: eventSlug, row_count: entries.length },
  });

  return new NextResponse(entriesToCsv(entries), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${eventSlug}-entries.csv"`,
      'cache-control': 'no-store',
    },
  });
}
