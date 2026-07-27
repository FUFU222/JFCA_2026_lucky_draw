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
