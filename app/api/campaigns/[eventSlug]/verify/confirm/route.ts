import { NextResponse } from 'next/server';

import { getRaffleService } from '../../../../../../lib/db/server';
import { readJsonObject } from '../../../_shared';

const LINK_INVALID = { ok: false, error: 'verification_link_invalid' } as const;

/**
 * Issuing a number is deliberately a POST: opening the emailed link only
 * renders a confirmation page, so a mail scanner that follows the URL cannot
 * consume the token or claim a number.
 */
export async function POST(request: Request, context: { params: Promise<{ eventSlug: string }> }) {
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json(LINK_INVALID, { status: 400 });

  const { eventSlug } = await context.params;
  const result = await getRaffleService().confirmVerification({ eventSlug, token: body.token });
  if (!result) return NextResponse.json(LINK_INVALID, { status: 400 });

  return NextResponse.json({
    ok: true,
    number: result.number.toString(),
    receipt_token: result.receiptToken,
  });
}
