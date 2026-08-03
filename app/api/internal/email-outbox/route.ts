import { NextResponse } from 'next/server';

import { getEmailOutboxProcessor } from '../../../../lib/db/server';
import { OUTBOX_BATCH_LIMIT } from '../../../../lib/email/outbox';
import { hasCronSecret } from '../../../../lib/security/cron-auth';

/**
 * Retry worker for messages the inline send could not deliver. A GitHub
 * Actions workflow (`.github/workflows/email-outbox.yml`) calls this every 5
 * minutes with `Authorization: Bearer ${CRON_SECRET}`, so the Hobby plan's
 * once-a-day Vercel Cron limit is not in the critical path. Nothing else may
 * reach it, so the response never reveals whether a job existed.
 *
 * GET is kept alongside POST in case this is ever called from Vercel Cron
 * instead, which issues GET.
 */
export const dynamic = 'force-dynamic';

/**
 * Declared rather than left to the platform default, which is 10-15 seconds
 * depending on plan — short enough to kill a run mid-batch and leave jobs
 * leased until they expire. The run budget below stays well inside it.
 */
export const maxDuration = 60;

async function run(request: Request): Promise<NextResponse> {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const summary = await getEmailOutboxProcessor().process(OUTBOX_BATCH_LIMIT);
  return NextResponse.json({ ok: true, ...summary });
}

export const GET = run;
export const POST = run;
