import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/**
 * `Authorization: Bearer ${CRON_SECRET}`, compared in constant time so the
 * value cannot be probed a byte at a time.
 *
 * Shared by `/api/internal/email-outbox` and `/api/health`'s authenticated
 * detail branch — the only two routes a cron caller or an operator reaches
 * with this credential.
 */
export function hasCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const scheme = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  const presented = scheme?.[1];
  if (!presented) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
