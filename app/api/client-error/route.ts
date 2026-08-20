import { NextResponse } from 'next/server';

import { clientIpAddress, readJsonObject } from '../campaigns/_shared';
import { createServiceRoleClient } from '../../../lib/db/server';
import { redactSensitive } from '../../../lib/observability/alerts';
import { reportServerError } from '../../../lib/observability/report';
import { SupabaseRateLimiter } from '../../../lib/raffle/rate-limit';

/**
 * A visitor's browser has no credential to present, so this is public like
 * `/api/health`'s GET — anyone can call it, which is exactly what makes the
 * IP-keyed rate limit below load-bearing rather than decorative.
 */
export const dynamic = 'force-dynamic';

const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
const MAX_FIELD_LENGTH = 500;

export async function POST(request: Request): Promise<NextResponse> {
  const ip = clientIpAddress(request) ?? 'unknown';
  const limiter = new SupabaseRateLimiter(createServiceRoleClient());
  const allowed = await limiter.consume(`client-error:${ip}`, RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS);
  if (!allowed) return NextResponse.json({ ok: false }, { status: 429 });

  const body = await readJsonObject(request);
  const message = typeof body?.message === 'string' ? body.message.slice(0, MAX_FIELD_LENGTH) : null;
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  // The path is what the visitor's browser reports, not a route pattern from
  // our own router — a receipt or verification link carries its bearer token
  // in the path itself, so it goes through the same redaction as an error
  // message before it can reach a chat channel.
  const path = typeof body?.path === 'string' ? body.path.slice(0, MAX_FIELD_LENGTH) : 'unknown';
  const route = `client:${redactSensitive(path, 200)}`;

  const error = new Error(message);
  if (typeof body?.stack === 'string') error.stack = body.stack.slice(0, 2000);

  await reportServerError(error, { route, kind: 'client' });

  return NextResponse.json({ ok: true });
}
