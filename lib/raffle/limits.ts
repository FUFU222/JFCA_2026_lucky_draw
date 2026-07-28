/**
 * Public-write allowances.
 *
 * The per-address limit is the one that protects a person: five attempts in a
 * day is far more than anyone needs, and it is what stops an address being
 * mail-bombed through the form.
 *
 * The per-IP limit is a coarse anti-automation net, and it has to be generous.
 * At a festival, hundreds of visitors share the venue's wifi and a handful of
 * carrier NAT addresses, so a low ceiling would stop real entrants rather than
 * bots. Both are configurable so an operator can raise them during the event by
 * changing an environment variable and redeploying, rather than editing code.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 24 * 60 * 60;

const DEFAULT_EMAIL_REQUEST_LIMIT = 5;
const DEFAULT_IP_REQUEST_LIMIT = 500;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function emailRequestLimit(env: Record<string, string | undefined> = process.env): number {
  return positiveInteger(env.RAFFLE_EMAIL_REQUEST_LIMIT, DEFAULT_EMAIL_REQUEST_LIMIT);
}

export function ipRequestLimit(env: Record<string, string | undefined> = process.env): number {
  return positiveInteger(env.RAFFLE_IP_REQUEST_LIMIT, DEFAULT_IP_REQUEST_LIMIT);
}
