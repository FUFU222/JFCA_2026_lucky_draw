import { NextResponse } from 'next/server';

import { getRaffleService } from '../../../../../lib/db/server';
import { clientIpAddress, invalidRequest, readJsonObject } from '../../_shared';

/**
 * Declared rather than left to the platform default of 10-15 seconds, same as
 * every other public write: this path calls Cloudflare, and a request killed
 * mid-call after the lookup allowance is already consumed spends one of a
 * visitor's five daily attempts without ever answering.
 */
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ eventSlug: string }> }) {
  const body = await readJsonObject(request);
  if (!body) return invalidRequest();

  const { eventSlug } = await context.params;
  const result = await getRaffleService().lookupNumber({
    eventSlug,
    email: body.email,
    turnstileToken: body.turnstile_token,
    ipAddress: clientIpAddress(request),
    isTest: body.is_test,
  });

  if (result.found) {
    return NextResponse.json({ ok: true, found: true, number: result.number.toString() });
  }

  switch (result.reason) {
    case 'invalid':
      return invalidRequest();
    case 'turnstile':
      return NextResponse.json({ ok: false, error: 'captcha_failed' }, { status: 403 });
    case 'rate_limited_network':
      return NextResponse.json({ ok: false, error: 'try_again_later' }, { status: 429 });
    case 'rate_limited_address':
      return NextResponse.json({ ok: false, error: 'try_again_later_address' }, { status: 429 });
    default:
      // No further distinction on purpose: an address that never entered and
      // one that entered but has not confirmed yet must read identically, so
      // a lookup cannot be used to learn who has entered but not verified.
      return NextResponse.json({ ok: true, found: false });
  }
}
