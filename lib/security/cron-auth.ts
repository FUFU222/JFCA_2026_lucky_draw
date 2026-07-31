import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/**
 * `Authorization: Bearer ${CRON_SECRET}`, compared in constant time so the
 * value cannot be probed a byte at a time.
 *
 * `app/api/internal/email-outbox/route.ts` has its own copy of this check,
 * written before this module existed. It is deliberately left alone rather than
 * refactored two weeks before a one-shot event; migrating it is a cleanup item
 * in docs/operations/readiness-gaps.md, not a change to make now.
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
