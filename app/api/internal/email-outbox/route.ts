import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getEmailOutboxProcessor } from '../../../../lib/db/server';
import { OUTBOX_BATCH_LIMIT } from '../../../../lib/email/outbox';

/**
 * Retry worker for messages the inline send could not deliver. Vercel Cron
 * calls this every minute with `Authorization: Bearer ${CRON_SECRET}`; nothing
 * else may reach it, so the response never reveals whether a job existed.
 *
 * Vercel Cron issues GET, so both verbs share one handler.
 */
export const dynamic = 'force-dynamic';

/**
 * Declared rather than left to the platform default, which is 10-15 seconds
 * depending on plan — short enough to kill a run mid-batch and leave jobs
 * leased until they expire. The run budget below stays well inside it.
 */
export const maxDuration = 30;

const RUN_BUDGET_MS = 20_000;

async function run(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const summary = await getEmailOutboxProcessor().process(OUTBOX_BATCH_LIMIT, RUN_BUDGET_MS);
  return NextResponse.json({ ok: true, ...summary });
}

export const GET = run;
export const POST = run;

function isAuthorizedCron(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  // The scheme is required, not stripped opportunistically: the only caller is
  // Vercel Cron, and it always sends `Bearer`.
  const scheme = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  const presented = scheme?.[1];
  if (!presented) return false;

  // Compared in constant time so the endpoint cannot be probed a byte at a time.
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
