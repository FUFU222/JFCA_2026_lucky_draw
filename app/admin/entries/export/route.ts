import { NextResponse } from 'next/server';

import { recordAudit } from '../../../../lib/admin/audit';
import { entryCsvHeader, entryCsvRow } from '../../../../lib/admin/csv';
import {
  countEntriesForExport,
  exportEntryPages,
  loadDashboard,
} from '../../../../lib/admin/queries';
import { ACTIVE_CAMPAIGN_SLUG } from '../../../../lib/campaign/config';
import { getOperatorSession } from '../../../../lib/security/operator-session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const operator = await getOperatorSession();
  if (!operator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const eventSlug = new URL(request.url).searchParams.get('event') ?? ACTIVE_CAMPAIGN_SLUG;
  const dashboard = await loadDashboard(eventSlug);
  if (!dashboard) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const rowCount = await countEntriesForExport(dashboard.campaign.id);

  // The record says who exported what and how much — never the rows themselves.
  await recordAudit({
    action: 'EXPORT_CSV',
    actorId: operator.userId,
    actorEmail: operator.email,
    campaignId: dashboard.campaign.id,
    metadata: { event_slug: eventSlug, row_count: rowCount },
  });

  // Streamed rather than buffered: 30,000 entries with profile data is several
  // megabytes, past the platform's response body limit for a buffered reply.
  const campaignId = dashboard.campaign.id;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(entryCsvHeader()));
      try {
        for await (const page of exportEntryPages(campaignId)) {
          for (const entry of page) controller.enqueue(encoder.encode(entryCsvRow(entry)));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${eventSlug}-entries.csv"`,
      'cache-control': 'no-store',
    },
  });
}
