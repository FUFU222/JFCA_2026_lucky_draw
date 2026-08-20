import type { MetadataRoute } from 'next';

/**
 * The visitor's pages are reached from a printed QR code, not from search, so
 * nothing here needs a crawler's help. What it needs is for three surfaces to
 * be left alone.
 *
 * `/admin` and `/auth` are the operator's. Both already refuse an anonymous
 * caller, so this is about not advertising them rather than about access.
 *
 * `/api` is here for `/api/health`, which is public and unauthenticated on
 * purpose — see docs/operations/monitoring.md. Its ten-second cache is a
 * module-level variable that only protects one warm instance, so a crawler
 * looping over it lands on several at once, each issuing its own read against
 * the database the numbering RPC depends on. That is P6 in
 * docs/operations/readiness-gaps.md, and keeping crawlers off it is the free
 * half of the answer.
 *
 * The two token-bearing paths are handled where they live instead — a
 * `noindex` on the page itself, rather than a `Disallow` line that would
 * publish the URL shape of a bearer credential in a file anyone can read.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: ['/admin', '/auth', '/api'],
    },
  };
}
