import type { CampaignSchedule } from '../db/types';

export const ACTIVE_CAMPAIGN_SLUG = 'jfca-2026';

export const activeCampaign = {
  slug: ACTIVE_CAMPAIGN_SLUG,
} as const;

const REGISTRATION_CLOSE_BUFFER_MS = 30 * 60 * 1000;

/**
 * `SCHEDULED` means the operator has intake switched on. The two timestamps are
 * optional bounds around that, not a requirement:
 *
 * - Both unset — the operator's status is the whole answer. This event is run
 *   that way, from the dashboard, by staff who are standing at the booth.
 * - `opens_at` set — intake will not start before it, however the status reads.
 * - `draw_starts_at` set — intake stops 30 minutes ahead of it without anyone
 *   acting, and `confirm_raffle_verification` independently refuses to issue a
 *   number past it.
 *
 * With no draw time set, that last backstop is gone and closing before the draw
 * is the operator's job — see the on-site runbook.
 */
export function isRegistrationOpen(
  campaign: CampaignSchedule,
  now: Date = new Date(),
): boolean {
  if (campaign.status !== 'SCHEDULED') return false;

  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) return false;

  // A bound that is present but unreadable closes intake rather than opening
  // it. A corrupt timestamp must never be the reason a gate stands wide.
  if (campaign.opens_at !== null) {
    const opensAtMs = new Date(campaign.opens_at).getTime();
    if (Number.isNaN(opensAtMs) || nowMs < opensAtMs) return false;
  }

  if (campaign.draw_starts_at !== null) {
    const drawStartsAtMs = new Date(campaign.draw_starts_at).getTime();
    if (Number.isNaN(drawStartsAtMs) || nowMs >= drawStartsAtMs - REGISTRATION_CLOSE_BUFFER_MS) {
      return false;
    }
  }

  return true;
}

/**
 * What the same URL should say when it is not accepting entries. `DRAFT` and an
 * opening bound that has not arrived both read as "not open yet"; a paused or
 * closed campaign, and one past its cut-off, read as finished. A visitor is
 * never shown the difference between paused and closed — that is the operator's
 * business, not theirs.
 */
export type RegistrationPhase = 'before' | 'open' | 'closed';

export function registrationPhase(
  campaign: CampaignSchedule,
  now: Date = new Date(),
): RegistrationPhase {
  if (isRegistrationOpen(campaign, now)) return 'open';
  if (campaign.status === 'PAUSED' || campaign.status === 'CLOSED') return 'closed';
  if (campaign.status === 'DRAFT') return 'before';

  // Scheduled but not open, so a bound is holding it. Only a not-yet-reached
  // opening reads as "before"; anything else has finished.
  if (campaign.opens_at !== null) {
    const opensAtMs = new Date(campaign.opens_at).getTime();
    if (Number.isNaN(opensAtMs) || now.getTime() < opensAtMs) return 'before';
  }
  return 'closed';
}
