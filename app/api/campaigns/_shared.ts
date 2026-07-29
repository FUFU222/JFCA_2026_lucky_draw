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

/**
 * The per-IP limit is only as trustworthy as the header it reads. `x-real-ip`
 * is a single value written by the edge proxy and is preferred; the first
 * `x-forwarded-for` entry is the fallback and is trustworthy only because the
 * platform overwrites that header on ingress. Confirm this against the
 * deployment platform before launch.
 */
export function clientIpAddress(request: Request): string | undefined {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
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
    // Only reachable from a verified operator session, so unlike every other
    // answer here this one can say exactly what is wrong without disclosing
    // anything to a visitor.
    case 'test_address_conflict':
      return NextResponse.json({ ok: false, error: 'test_address_conflict' }, { status: 409 });
  }
}
