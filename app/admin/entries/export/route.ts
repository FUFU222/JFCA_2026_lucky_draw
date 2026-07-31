import { NextResponse } from 'next/server';

import { recordAudit } from '../../../../lib/admin/audit';
import { entryCsvHeader, entryCsvRow } from '../../../../lib/admin/csv';
import {
  countEntriesForExport,
  exportEntryPages,
  loadDashboard,
} from '../../../../lib/admin/queries';
import { ACTIVE_CAMPAIGN_SLUG } from '../../../../lib/campaign/config';
import { getOperatorSession, type OperatorSession } from '../../../../lib/security/operator-session';

/**
 * A row shaped like every other one so it cannot break a spreadsheet's column
 * count, with values no real entrant could ever have — a number is always
 * numeric, an email always has an `@` — so it cannot be mistaken for one.
 * Placed last because a streamed response has no way to say anything before
 * the rows that already went out.
 */
function truncationMarkerRow(written: number, expected: number): string {
  return entryCsvRow({
    number: '*** EXPORT INCOMPLETE ***',
    email: `Only ${written} of ${expected} expected rows arrived. Re-run the export.`,
  });
}

async function recordIncompleteExport(args: {
  operator: OperatorSession;
  campaignId: string;
  eventSlug: string;
  expectedRowCount: number;
  writtenRowCount: number;
  error?: string;
}): Promise<void> {
  await recordAudit({
    action: 'EXPORT_CSV_INCOMPLETE',
    actorId: args.operator.userId,
    actorEmail: args.operator.email,
    campaignId: args.campaignId,
    metadata: {
      event_slug: args.eventSlug,
      expected_row_count: args.expectedRowCount,
      written_row_count: args.writtenRowCount,
      ...(args.error ? { error: args.error } : {}),
    },
  });
}

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
  //
  // The response is already 200 with the download headers sent by the time
  // any of this runs, so a mid-stream failure cannot become a different HTTP
  // status — the browser has already committed to saving whatever arrives.
  // `writtenRows` is what lets a short export be told apart from a complete
  // one: a trailing row inside the file itself, because that is the one
  // artifact the operator actually opens, and a corrective audit entry,
  // because the one written before the stream started can only promise what
  // was asked for, not what arrived.
  const campaignId = dashboard.campaign.id;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (line: string) => controller.enqueue(encoder.encode(line));
      enqueue(entryCsvHeader());

      let writtenRows = 0;
      try {
        for await (const page of exportEntryPages(campaignId)) {
          for (const entry of page) {
            enqueue(entryCsvRow(entry));
            writtenRows += 1;
          }
        }

        // More than expected is a benign drift — a real entrant confirmed
        // between the count above and this loop finishing. Fewer is not.
        if (writtenRows < rowCount) {
          enqueue(truncationMarkerRow(writtenRows, rowCount));
          await recordIncompleteExport({
            operator,
            campaignId: dashboard.campaign.id,
            eventSlug,
            expectedRowCount: rowCount,
            writtenRowCount: writtenRows,
          });
        }

        controller.close();
      } catch (error) {
        // Best-effort: if the connection itself is what broke, this enqueue
        // fails too and is swallowed rather than masking the real error.
        try {
          enqueue(truncationMarkerRow(writtenRows, rowCount));
        } catch {
          // See above.
        }
        await recordIncompleteExport({
          operator,
          campaignId: dashboard.campaign.id,
          eventSlug,
          expectedRowCount: rowCount,
          writtenRowCount: writtenRows,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {
          // The original error is the one that matters; a failed corrective
          // audit write must not replace it.
        });
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
