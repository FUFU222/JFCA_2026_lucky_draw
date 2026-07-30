'use client';

import { useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';
const LOAD_TIMEOUT_MS = 15_000;

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove?: (widgetId: string) => void;
  reset?: (widgetId: string) => void;
}

declare global {
  var turnstile: TurnstileApi | undefined;
}

export interface TurnstileWidgetProps {
  siteKey: string;
  /** Called with a token when the challenge passes, and with null when it lapses. */
  onToken: (token: string | null) => void;
  onError: () => void;
  /**
   * Incremented by the form after every submission. Cloudflare rejects a
   * response token that has already been verified, so a fresh challenge has to
   * be run before the next request rather than reusing the spent one.
   */
  resetKey?: number;
}

/**
 * Renders the challenge explicitly rather than through auto-discovery, so the
 * token reaches React state instead of a hidden input, and so the send action
 * can stay disabled until a token actually exists.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  onError,
  resetKey = 0,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onError });

  // Cloudflare keeps whichever callbacks it was handed at render time, so the
  // ref is what lets a later token reach the current state setters.
  useEffect(() => {
    callbacks.current = { onToken, onError };
  });

  useEffect(() => {
    let cancelled = false;

    const tryRender = () => {
      if (cancelled || widgetIdRef.current !== null) return true;
      const container = containerRef.current;
      if (!container || !globalThis.turnstile) return false;

      widgetIdRef.current = globalThis.turnstile.render(container, {
        sitekey: siteKey,
        // Pinned, because Turnstile otherwise follows the device language, and
        // the visitor's pages are English only by decision — the Japanese copy
        // and the language switcher were removed, and `0007_english_only.sql`
        // constrains the stored locale to 'en'. On a Japanese phone this
        // widget was the one thing on the page still speaking Japanese.
        language: 'en',
        // Normal is a fixed 300px, which is wider than the inside of the
        // confirmation dialog on a 375px phone and pushed the panel off the
        // screen. Flexible fills its container instead — still no narrower
        // than 300px, so the container has to be at least that, which is what
        // the dialog's mobile padding is set for.
        size: 'flexible',
        callback: (token: string) => callbacks.current.onToken(token),
        'error-callback': () => callbacks.current.onError(),
        // A lapsed token must invalidate the send action, not sit there stale.
        'expired-callback': () => callbacks.current.onToken(null),
        'timeout-callback': () => callbacks.current.onToken(null),
      });
      return true;
    };

    if (!tryRender()) {
      const existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        // A script element left over from a failed load has no handler attached
        // to this mount, so without this the widget would poll forever and the
        // visitor would sit on "Checking your browser…" with no error at all.
        existing.addEventListener('error', () => callbacks.current.onError(), { once: true });
      } else {
        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        script.onerror = () => callbacks.current.onError();
        document.head.appendChild(script);
      }

      // The script may already have failed before this mount, in which case no
      // error event will ever fire again. Give up rather than poll forever.
      const giveUp = setTimeout(() => {
        clearInterval(poll);
        if (widgetIdRef.current === null) callbacks.current.onError();
      }, LOAD_TIMEOUT_MS);
      const poll = setInterval(() => {
        if (tryRender()) {
          clearInterval(poll);
          clearTimeout(giveUp);
        }
      }, 150);
      return () => {
        cancelled = true;
        clearInterval(poll);
        clearTimeout(giveUp);
        removeWidget(widgetIdRef);
      };
    }

    return () => {
      cancelled = true;
      removeWidget(widgetIdRef);
    };
  }, [siteKey]);

  // A spent token cannot be verified twice, so every submission asks Cloudflare
  // for a new one.
  //
  // Only on a real change, never on the mount pass. A widget mounted while the
  // round is already above zero — which is every widget rendered after the
  // first submission, including the one in the resend dialog — used to render
  // a challenge and then immediately reset it, spending two for one and
  // blanking the token it had just been handed.
  const seenResetKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey === seenResetKey.current || widgetIdRef.current === null) return;
    seenResetKey.current = resetKey;
    callbacks.current.onToken(null);
    try {
      globalThis.turnstile?.reset?.(widgetIdRef.current);
    } catch {
      callbacks.current.onError();
    }
  }, [resetKey]);

  return <div ref={containerRef} data-testid="turnstile-widget" />;
}

/**
 * Cloudflare keeps its own registry of rendered widgets. Leaving one behind
 * when the form is replaced makes it complain about a widget it can no longer
 * find, and leaks the iframe it created.
 */
function removeWidget(widgetIdRef: { current: string | null }) {
  const widgetId = widgetIdRef.current;
  widgetIdRef.current = null;
  if (!widgetId) return;
  try {
    globalThis.turnstile?.remove?.(widgetId);
  } catch {
    // The widget may already be gone with the page.
  }
}
