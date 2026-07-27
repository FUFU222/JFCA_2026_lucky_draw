import { describe, expect, it } from 'vitest';

import { ACTIVE_CAMPAIGN_SLUG, isRegistrationOpen } from '../../lib/campaign/config';

describe('campaign configuration', () => {
  it('identifies jfca-2026 as the active campaign', () => {
    expect(ACTIVE_CAMPAIGN_SLUG).toBe('jfca-2026');
  });

  it('opens only scheduled campaigns within their eligibility window', () => {
    const now = new Date('2026-08-01T16:00:00.000Z');
    const baseCampaign = {
      status: 'SCHEDULED' as const,
      opens_at: '2026-08-01T15:00:00.000Z',
      draw_starts_at: '2026-08-01T17:00:00.000Z',
    };

    expect(isRegistrationOpen(baseCampaign, now)).toBe(true);
    expect(isRegistrationOpen({ ...baseCampaign, status: 'DRAFT' }, now)).toBe(false);
    expect(isRegistrationOpen({ ...baseCampaign, status: 'PAUSED' }, now)).toBe(false);
    expect(isRegistrationOpen({ ...baseCampaign, status: 'CLOSED' }, now)).toBe(false);
    expect(isRegistrationOpen({ ...baseCampaign, opens_at: null }, now)).toBe(false);
    expect(isRegistrationOpen({ ...baseCampaign, draw_starts_at: null }, now)).toBe(false);
    expect(
      isRegistrationOpen(
        { ...baseCampaign, draw_starts_at: '2026-08-01T16:30:00.000Z' },
        now,
      ),
    ).toBe(false);
  });
});
