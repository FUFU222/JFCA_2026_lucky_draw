/**
 * Next.js calls this once per server start, which is the only place a
 * misconfiguration can be caught before it reaches a visitor.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertRaffleConfiguration } = await import('./lib/config/startup');
  assertRaffleConfiguration();
}

/**
 * Next.js hands every unhandled server-side error to this hook — route
 * handlers, server components and the render itself — which is the only place
 * that sees all of them without wrapping each one by hand.
 *
 * Imported lazily so a fault in the reporter cannot stop the server booting,
 * and it reports the route rather than the URL because a receipt URL is a
 * bearer token and must not be written to a log or an alert channel.
 */
export async function onRequestError(
  error: unknown,
  request: { method?: string },
  context: { routePath?: string; routeType?: string },
): Promise<void> {
  try {
    const { reportServerError } = await import('./lib/observability/report');
    const method = request?.method ?? 'GET';
    const path = context?.routePath ?? 'unknown';
    await reportServerError(error, { route: `${method} ${path}`, kind: context?.routeType });
  } catch {
    // Reporting is best-effort by definition; the platform's own log still has
    // the original error.
  }
}
