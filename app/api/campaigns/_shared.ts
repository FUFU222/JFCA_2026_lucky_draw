import { NextResponse } from 'next/server';

import type { RaffleRequestResult } from '../../../lib/raffle/service';

/**
 * Every public write answers with the same wording whether or not the address
 * is already registered, so a response can never be used to probe for one.
 */
const ACCEPTED = {
  ok: true,
  message: 'If eligible, check your email for a verification link.',
} as const;

export function clientIpAddress(request: Request): string | undefined {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function invalidRequest(): NextResponse {
  return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 });
}

export function raffleRequestResponse(result: RaffleRequestResult): NextResponse {
  if (result.accepted) return NextResponse.json(ACCEPTED, { status: 202 });

  switch (result.reason) {
    case 'invalid':
      return invalidRequest();
    case 'turnstile':
      return NextResponse.json({ ok: false, error: 'captcha_failed' }, { status: 403 });
    case 'rate_limited':
      return NextResponse.json({ ok: false, error: 'try_again_later' }, { status: 429 });
    case 'closed':
      return NextResponse.json({ ok: false, error: 'registration_unavailable' }, { status: 403 });
  }
}
