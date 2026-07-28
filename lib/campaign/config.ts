import type { CampaignSchedule } from '../db/types';

export const ACTIVE_CAMPAIGN_SLUG = 'jfca-2026';

export const activeCampaign = {
  slug: ACTIVE_CAMPAIGN_SLUG,
} as const;

const REGISTRATION_CLOSE_BUFFER_MS = 30 * 60 * 1000;

export function isRegistrationOpen(
  campaign: CampaignSchedule,
  now: Date = new Date(),
): boolean {
  if (
    campaign.status !== 'SCHEDULED' ||
    campaign.opens_at === null ||
    campaign.draw_starts_at === null
  ) {
    return false;
  }

  const nowMs = now.getTime();
  const opensAtMs = new Date(campaign.opens_at).getTime();
  const drawStartsAtMs = new Date(campaign.draw_starts_at).getTime();

  if (Number.isNaN(nowMs) || Number.isNaN(opensAtMs) || Number.isNaN(drawStartsAtMs)) {
    return false;
  }

  return nowMs >= opensAtMs && nowMs < drawStartsAtMs - REGISTRATION_CLOSE_BUFFER_MS;
}

/**
 * What the same URL should say when it is not accepting entries. `DRAFT` and a
 * not-yet-reached opening both read as "not open yet"; a paused or closed
 * campaign, and one past its cut-off, read as finished.
 */
export type RegistrationPhase = 'before' | 'open' | 'closed';

export function registrationPhase(
  campaign: CampaignSchedule,
  now: Date = new Date(),
): RegistrationPhase {
  if (isRegistrationOpen(campaign, now)) return 'open';
  if (campaign.status === 'PAUSED' || campaign.status === 'CLOSED') return 'closed';
  if (campaign.status === 'DRAFT' || campaign.opens_at === null) return 'before';

  const opensAtMs = new Date(campaign.opens_at).getTime();
  if (Number.isNaN(opensAtMs)) return 'before';
  return now.getTime() < opensAtMs ? 'before' : 'closed';
}
