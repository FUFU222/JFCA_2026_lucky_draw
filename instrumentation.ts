/**
 * Next.js calls this once per server start, which is the only place a
 * misconfiguration can be caught before it reaches a visitor.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertRaffleConfiguration } = await import('./lib/config/startup');
  assertRaffleConfiguration();
}
