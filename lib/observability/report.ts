import 'server-only';

import { AlertThrottle, formatAlert, redactSensitive, summarizeError } from './alerts';

/**
 * Where a server-side fault goes.
 *
 * Two layers, because they fail differently. The structured log line always
 * happens and needs no configuration, so a fault is recoverable from the
 * platform's logs afterwards. The webhook is what makes somebody find out
 * *during* the event, which the logs cannot do — nobody watches a log stream at
 * a festival booth.
 *
 * Neither layer may ever be the reason a request fails, so everything here
 * swallows its own errors.
 */

const throttle = new AlertThrottle();

/**
 * A visitor's browser can report a client-side fault through an endpoint
 * that has to stay unauthenticated, unlike every other caller of
 * `reportServerError`. Sharing `throttle`'s budget with it would let a flood
 * of fabricated client errors spend the hourly cap and silently suppress a
 * real server-side alert for the rest of the window — the one outcome this
 * whole system exists to prevent. A separate, smaller budget means the worst
 * a hostile client can do is drown out other client errors, never a server
 * one.
 */
const clientThrottle = new AlertThrottle({ maxPerWindow: 10 });

export interface ErrorContext {
  /** Route or job the fault came from, e.g. `POST /api/campaigns/…/entries`. */
  route?: string;
  /** Free-form label for faults that are not requests, e.g. `outbox-worker`. */
  kind?: string;
}

export async function reportServerError(error: unknown, context: ErrorContext = {}): Promise<void> {
  const route = context.route ?? context.kind ?? 'unknown';
  const summary = summarizeError(error, route);

  // One line, one JSON object: greppable in the Vercel log viewer, and it
  // survives whatever the alert channel does.
  try {
    console.error(
      `[error] ${JSON.stringify({
        name: summary.name,
        message: summary.message,
        route: summary.route,
        fingerprint: summary.fingerprint,
        stack: error instanceof Error ? redactStack(error.stack) : undefined,
      })}`,
    );
  } catch {
    // A message that cannot be serialised must not take the request with it.
    console.error('[error] unserialisable failure at', route);
  }

  await notify(summary, context.kind === 'client' ? clientThrottle : throttle);
}

async function notify(
  summary: ReturnType<typeof summarizeError>,
  throttleFor: AlertThrottle,
): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return;

  const decision = throttleFor.decide(summary.fingerprint, Date.now());
  if (!decision.send) return;

  const text = formatAlert(summary, {
    suppressed: decision.suppressed,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `text` is what Slack and Google Chat read; `content` is what Discord
      // reads. Sending both means the operator can point this at whichever
      // channel they already have open, with no code change.
      body: JSON.stringify({ text, content: text }),
      // An alert is never worth holding a response open for. If the channel is
      // slow, the log line above is still there.
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Including the case where the alert channel itself is the outage.
  }
}

/**
 * A stack trace is long enough to bury the useful line, and on some runtimes a
 * frame carries an argument worth redacting. Keep the top of it, redacted.
 */
function redactStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return redactSensitive(stack.split('\n').slice(0, 6).join('\n'), 1200);
}
