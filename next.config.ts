import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // This app lives in a git worktree nested under the monorepo-style parent
  // directory, which also has a pnpm-workspace.yaml. Without an explicit
  // root, Turbopack infers the parent as the workspace root and then fails
  // to resolve client component modules ("Could not find the module ...
  // in the React Client Manifest").
  turbopack: {
    root: __dirname,
  },

  /**
   * Response headers, on every route.
   *
   * Deliberately not a content CSP. `script-src` on an App Router page needs
   * either `'unsafe-inline'` — which buys nothing, since the hydration payload
   * is inline script and an attacker's injection would be too — or a per-request
   * nonce, which needs middleware this app does not have. React escapes by
   * default and nothing here reaches for `dangerouslySetInnerHTML`, so the
   * honest version is the one directive that does real work today.
   *
   * `Strict-Transport-Security` is absent on purpose: Vercel sets it on a custom
   * domain, and a second copy from here is a second thing to keep correct.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Both spellings of the same rule. `frame-ancestors` is the one
          // browsers actually consult; `X-Frame-Options` is what a scanner and
          // an older client look for. No page in this app is framed by another
          // — the only iframe involved is the one Turnstile renders *inside*
          // our own page, which this does not touch.
          //
          // What it stops: an operator is signed in at the booth, opens some
          // other page on the same phone, and that page frames /admin under a
          // decoy button to walk them through 受付を終了. The Supabase auth
          // cookie is SameSite=Lax and so is withheld from a cross-site frame
          // today, which already breaks that — this is the layer that does not
          // depend on a cookie attribute set by a dependency.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          // The CSV export is the one response whose content type must be
          // believed rather than sniffed: it carries entrants' names, and a
          // browser that decides a name-shaped byte sequence is HTML would be
          // rendering visitor-supplied text as a document.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Already every browser's default. Pinned because the paths here are
          // credentials — /:eventSlug/number/:token is a bearer URL — and a
          // default is a thing that can change under you.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
