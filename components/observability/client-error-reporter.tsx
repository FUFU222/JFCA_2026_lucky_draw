'use client';

import { useEffect } from 'react';

/**
 * Same-origin check for `ErrorEvent.filename`. A bare "Script error." with no
 * filename, or a filename on another origin, is a browser extension or a
 * host app's own injected script (the LINE/Instagram in-app browsers do
 * this) — there is nothing here we can act on, and reporting it would only
 * be noise crowding out the errors that are actually ours.
 */
function isOwnScript(filename: string | undefined): boolean {
  if (!filename || typeof window === 'undefined') return false;
  try {
    return new URL(filename, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function report(message: string, stack: string | undefined): void {
  try {
    // A rejected fetch (offline, DNS failure — plausible on event WiFi) is a
    // rejected promise, which this same component's own unhandledrejection
    // listener would otherwise pick up and try to report again, looping for
    // as long as the network is down. The `.catch` here, not the `try` above,
    // is what actually stops that: `try` only guards a synchronous throw.
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, stack, path: window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Best-effort by definition; a visitor's flow must never wait on this.
  }
}

/**
 * The browser-side counterpart to `instrumentation.ts`'s `onRequestError` —
 * a server-side fault is caught no matter where it happens, but a fault in
 * the visitor's own browser (before a request is ever sent) was invisible
 * until this existed. Mounted once, renders nothing.
 */
export function ClientErrorReporter(): null {
  useEffect(() => {
    function onError(event: ErrorEvent): void {
      if (!isOwnScript(event.filename)) return;
      report(event.message, event.error instanceof Error ? event.error.stack : undefined);
    }

    // Unlike onError, this has no filename to check the origin of — a
    // rejection from Cloudflare Turnstile's own script would be reported the
    // same as one from our own code. Left unfiltered on purpose: the
    // dedicated client-error alert budget (see `clientThrottle` in
    // lib/observability/report.ts) already bounds how much noise any one
    // source, third-party or not, can generate.
    function onRejection(event: PromiseRejectionEvent): void {
      const reason: unknown = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      report(message, stack);
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
