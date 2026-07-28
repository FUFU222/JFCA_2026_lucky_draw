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
  useEffect(() => {
    if (resetKey === 0 || widgetIdRef.current === null) return;
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
