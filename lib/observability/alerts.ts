/**
 * The pure half of error reporting: what an alert is allowed to say, when two
 * occurrences count as the same fault, and how often a channel may hear about
 * one. No IO lives here on purpose — every rule below is a decision that has
 * to be testable without a webhook and without a clock.
 */

/**
 * An alert leaves the system and lands in a chat channel, which is a far less
 * controlled place than the database. Anything that could carry a visitor's
 * address or a bearer credential is removed before it can get there.
 *
 * Entry ids (UUIDs) are deliberately kept: they are what makes an alert
 * actionable, and on their own they identify nothing without database access.
 */
const REDACTIONS: readonly [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  // Known credential shapes, which are shorter than the generic rule below.
  [/\bre_[A-Za-z0-9_-]{8,}/g, '[resend-key]'],
  [/\bsbp_[A-Za-z0-9_-]{8,}/g, '[supabase-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+){1,2}/g, '[jwt]'],
  [/\bBearer\s+\S+/gi, 'Bearer [redacted]'],
  // Anything long enough to be a hash or a derived token. The threshold is 40
  // rather than 32 so a 36-character UUID survives it — a SHA-256 hex digest
  // is 64 and every token in this system is longer than that bound.
  [/[A-Za-z0-9_-]{40,}/g, '[token]'],
];

const MAX_MESSAGE_LENGTH = 400;

export function redactSensitive(text: string, maxLength = MAX_MESSAGE_LENGTH): string {
  let output = text;
  for (const [pattern, replacement] of REDACTIONS) {
    output = output.replace(pattern, replacement);
  }
  return output.length > maxLength ? `${output.slice(0, maxLength)}…` : output;
}

export interface ErrorSummary {
  name: string;
  message: string;
  /** Where it happened, as far as the caller could tell. */
  route: string;
  fingerprint: string;
}

/**
 * Reduces an unknown thrown value to something that can be logged and grouped.
 * A thrown non-Error is common enough in a Next.js app — a rejected fetch, a
 * string from a library — that it cannot be treated as unreachable.
 */
export function summarizeError(error: unknown, route = 'unknown'): ErrorSummary {
  const name = error instanceof Error ? error.name || 'Error' : typeof error;
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const message = redactSensitive(rawMessage);

  return { name, message, route, fingerprint: fingerprintError(name, message, route) };
}

/**
 * Two occurrences are the same fault when they share a name, a route and the
 * shape of their message. Redaction happens before this, which helps: a
 * per-visitor address in the text would otherwise make every occurrence unique
 * and defeat the throttle at the exact moment it matters most.
 */
export function fingerprintError(name: string, message: string, route: string): string {
  // Digits vary between occurrences of one fault (row counts, ids, ports) and
  // carry no grouping value.
  const shape = message.replace(/\d+/g, '#').slice(0, 120);
  return `${route}|${name}|${shape}`;
}

export interface ThrottleDecision {
  send: boolean;
  /**
   * How many occurrences of this fingerprint were swallowed since the last one
   * that got through, so the alert that does go out can say so. A channel that
   * shows one line for a hundred failures is worse than useless — it reads as a
   * one-off.
   */
  suppressed: number;
}

export interface ThrottleOptions {
  /** Minimum gap between alerts for the same fault. */
  cooldownMs?: number;
  /** Ceiling across all faults, so an outage cannot flood the channel. */
  maxPerWindow?: number;
  windowMs?: number;
}

/**
 * Rate limiting for the alert channel.
 *
 * This is per-instance state, and a serverless deployment has many instances,
 * so the real ceiling is this one multiplied by however many are warm. That is
 * accepted: the purpose is to stop one fault repeating a thousand times in a
 * minute, not to guarantee an exact count.
 */
export class AlertThrottle {
  private readonly cooldownMs: number;
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly lastSentAt = new Map<string, number>();
  private readonly suppressedSince = new Map<string, number>();
  private windowStartedAt = 0;
  private sentInWindow = 0;

  constructor(options: ThrottleOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? 5 * 60 * 1000;
    this.maxPerWindow = options.maxPerWindow ?? 20;
    this.windowMs = options.windowMs ?? 60 * 60 * 1000;
  }

  decide(fingerprint: string, nowMs: number): ThrottleDecision {
    if (nowMs - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = nowMs;
      this.sentInWindow = 0;
    }

    const previous = this.lastSentAt.get(fingerprint);
    const withinCooldown = previous !== undefined && nowMs - previous < this.cooldownMs;

    if (withinCooldown || this.sentInWindow >= this.maxPerWindow) {
      this.suppressedSince.set(fingerprint, (this.suppressedSince.get(fingerprint) ?? 0) + 1);
      return { send: false, suppressed: this.suppressedSince.get(fingerprint) ?? 0 };
    }

    const suppressed = this.suppressedSince.get(fingerprint) ?? 0;
    this.suppressedSince.delete(fingerprint);
    this.lastSentAt.set(fingerprint, nowMs);
    this.sentInWindow += 1;
    return { send: true, suppressed };
  }
}

/**
 * The line a human reads in a chat channel. Deliberately short: the detail is
 * in the log, and an alert that needs scrolling is an alert that gets ignored.
 */
export function formatAlert(
  summary: ErrorSummary,
  options: { suppressed?: number; appUrl?: string } = {},
): string {
  const parts = [`Lucky Draw error — ${summary.name} at ${summary.route}`, summary.message];
  if (options.suppressed && options.suppressed > 0) {
    parts.push(`(${options.suppressed} more like it were suppressed)`);
  }
  if (options.appUrl) parts.push(options.appUrl);
  return parts.join('\n');
}
