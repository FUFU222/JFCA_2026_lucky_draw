import 'server-only';

import { isRegistrationOpen } from '../campaign/config';
import { createServiceRoleClient } from '../db/server';
import type { CampaignStatus } from '../db/types';

/**
 * What an outside monitor can learn about this deployment without an account.
 *
 * The point of this module is to answer one question an uptime check on the
 * visitor's page cannot: *is the system still able to take an entry.* A page
 * that renders "entries are not open yet" is a healthy page, and the two
 * silent failures that actually matter at a festival — the database gone, or
 * mail piling up unsent — both look fine from the outside.
 */

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthSnapshot {
  database: { ok: boolean; latencyMs: number; error: string | null };
  campaign: { found: boolean; status: CampaignStatus | null; accepting: boolean };
  /** `null` when the count itself could not be read. */
  outboxWaiting: number | null;
  errorTrackingEnabled: boolean;
}

export interface HealthVerdict {
  status: HealthStatus;
  /** 503 only when a visitor could not complete an entry right now. */
  httpStatus: 200 | 503;
  reasons: string[];
}

export const DEFAULT_OUTBOX_BACKLOG_THRESHOLD = 50;

/**
 * The whole decision, as a pure function.
 *
 * `accepting` never affects the verdict, and that is deliberate. A campaign is
 * legitimately not accepting entries for all but a few hours of its life, so
 * treating that as unhealthy would mean an alarm that is firing on every day it
 * is not needed and therefore ignored on the one day it is. The flag is
 * reported instead, and the runbook says to put a keyword monitor on it for the
 * event itself — see docs/operations/monitoring.md.
 */
export function evaluateHealth(
  snapshot: HealthSnapshot,
  backlogThreshold = DEFAULT_OUTBOX_BACKLOG_THRESHOLD,
): HealthVerdict {
  const reasons: string[] = [];

  if (!snapshot.database.ok) {
    reasons.push('database unreachable');
  }
  // A missing campaign row means the printed QR code resolves to nothing. It is
  // as fatal as the database being down, and far easier to cause by accident.
  if (snapshot.database.ok && !snapshot.campaign.found) {
    reasons.push('campaign row missing');
  }

  if (reasons.length > 0) {
    return { status: 'down', httpStatus: 503, reasons };
  }

  if (snapshot.outboxWaiting === null) {
    reasons.push('outbox depth unreadable');
  } else if (snapshot.outboxWaiting > backlogThreshold) {
    reasons.push(`${snapshot.outboxWaiting} messages waiting to send`);
  }

  return reasons.length > 0
    ? { status: 'degraded', httpStatus: 200, reasons }
    : { status: 'ok', httpStatus: 200, reasons };
}

/**
 * Parsed leniently, unlike the request limits in `lib/config/startup.ts`, which
 * refuse to boot on a bad value. The difference is what a wrong value costs: a
 * mis-set request limit locks visitors out of the event, whereas this one only
 * changes when an advisory label reads `degraded`.
 */
export function outboxBacklogThreshold(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.OUTBOX_BACKLOG_THRESHOLD?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_OUTBOX_BACKLOG_THRESHOLD;
}

const CACHE_TTL_MS = 10_000;
let cached: { at: number; slug: string; snapshot: HealthSnapshot } | null = null;

/**
 * Reads the snapshot, at most once every {@link CACHE_TTL_MS}.
 *
 * The endpoint is unauthenticated so that a free monitoring tier can reach it,
 * which means anyone can call it as fast as they like. The cache is what stops
 * that turning into database load.
 *
 * Keyed by slug, which is not a detail: a cache that ignored it would let a
 * request for any other campaign serve its answer to the monitor watching this
 * one, for the next ten seconds.
 */
export async function collectHealth(slug: string, now = () => Date.now()): Promise<HealthSnapshot> {
  const nowMs = now();
  if (cached && cached.slug === slug && nowMs - cached.at < CACHE_TTL_MS) return cached.snapshot;

  const snapshot = await readSnapshot(slug, now);
  cached = { at: nowMs, slug, snapshot };
  return snapshot;
}

async function readSnapshot(slug: string, now: () => number): Promise<HealthSnapshot> {
  const errorTrackingEnabled = Boolean(process.env.ALERT_WEBHOOK_URL?.trim());
  const startedAt = now();

  let client: ReturnType<typeof createServiceRoleClient>;
  try {
    client = createServiceRoleClient();
  } catch (error) {
    return {
      database: { ok: false, latencyMs: 0, error: describe(error) },
      campaign: { found: false, status: null, accepting: false },
      outboxWaiting: null,
      errorTrackingEnabled,
    };
  }

  const { data, error } = await client
    .from('campaigns')
    .select('id, status, opens_at, draw_starts_at')
    .eq('slug', slug)
    .maybeSingle();
  const latencyMs = now() - startedAt;

  if (error) {
    return {
      database: { ok: false, latencyMs, error: describe(error) },
      campaign: { found: false, status: null, accepting: false },
      outboxWaiting: null,
      errorTrackingEnabled,
    };
  }

  const campaign = data as
    | { id: string; status: CampaignStatus; opens_at: string | null; draw_starts_at: string | null }
    | null;

  if (!campaign) {
    return {
      database: { ok: true, latencyMs, error: null },
      campaign: { found: false, status: null, accepting: false },
      outboxWaiting: null,
      errorTrackingEnabled,
    };
  }

  // Scoped exactly like the dashboard's 送信待ちメール数 gauge: this campaign's
  // real entries only, so an operator's rehearsals never raise the alarm.
  const waiting = await client
    .from('email_outbox')
    .select('id, raffle_entries!inner(campaign_id, is_test)', { count: 'exact', head: true })
    .in('status', ['PENDING', 'PROCESSING', 'FAILED'])
    .eq('raffle_entries.campaign_id', campaign.id)
    .eq('raffle_entries.is_test', false);

  return {
    database: { ok: true, latencyMs, error: null },
    campaign: {
      found: true,
      status: campaign.status,
      accepting: isRegistrationOpen(campaign, new Date(now())),
    },
    outboxWaiting: waiting.error ? null : waiting.count ?? 0,
    errorTrackingEnabled,
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : 'unknown error';
}
