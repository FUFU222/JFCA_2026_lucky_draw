import { describe, expect, it } from 'vitest';

import {
  ACTIVE_CAMPAIGN_SLUG,
  isRegistrationOpen,
  registrationPhase,
} from '../../lib/campaign/config';

const now = new Date('2026-08-01T16:00:00.000Z');

const bounded = {
  status: 'SCHEDULED' as const,
  opens_at: '2026-08-01T15:00:00.000Z',
  draw_starts_at: '2026-08-01T17:00:00.000Z',
};

describe('campaign configuration', () => {
  it('identifies jfca-2026 as the active campaign', () => {
    expect(ACTIVE_CAMPAIGN_SLUG).toBe('jfca-2026');
  });

  it('lets the operator alone decide when no bounds are set', () => {
    // How this event is actually run: staff at the booth, no schedule.
    const manual = { status: 'SCHEDULED' as const, opens_at: null, draw_starts_at: null };

    expect(isRegistrationOpen(manual, now)).toBe(true);
    expect(isRegistrationOpen({ ...manual, status: 'DRAFT' }, now)).toBe(false);
    expect(isRegistrationOpen({ ...manual, status: 'PAUSED' }, now)).toBe(false);
    expect(isRegistrationOpen({ ...manual, status: 'CLOSED' }, now)).toBe(false);
  });

  it('treats each timestamp as an optional bound rather than a requirement', () => {
    expect(isRegistrationOpen(bounded, now)).toBe(true);

    // An opening bound on its own still holds intake shut until it arrives.
    expect(
      isRegistrationOpen({ ...bounded, opens_at: '2026-08-01T18:00:00.000Z', draw_starts_at: null }, now),
    ).toBe(false);
    expect(isRegistrationOpen({ ...bounded, draw_starts_at: null }, now)).toBe(true);

    // A draw bound on its own still closes intake 30 minutes ahead of it.
    expect(isRegistrationOpen({ ...bounded, opens_at: null }, now)).toBe(true);
    expect(
      isRegistrationOpen({ ...bounded, opens_at: null, draw_starts_at: '2026-08-01T16:20:00.000Z' }, now),
    ).toBe(false);
    expect(isRegistrationOpen({ ...bounded, draw_starts_at: '2026-08-01T16:30:00.000Z' }, now)).toBe(
      false,
    );
  });

  it('closes rather than opens when a bound is present but unreadable', () => {
    // A corrupt timestamp must never be the reason a gate stands wide.
    expect(isRegistrationOpen({ ...bounded, opens_at: 'not a date' }, now)).toBe(false);
    expect(isRegistrationOpen({ ...bounded, draw_starts_at: 'not a date' }, now)).toBe(false);
  });

  it('never shows a visitor the difference between paused and closed', () => {
    const manual = { status: 'SCHEDULED' as const, opens_at: null, draw_starts_at: null };

    expect(registrationPhase(manual, now)).toBe('open');
    expect(registrationPhase({ ...manual, status: 'DRAFT' }, now)).toBe('before');
    expect(registrationPhase({ ...manual, status: 'PAUSED' }, now)).toBe('closed');
    expect(registrationPhase({ ...manual, status: 'CLOSED' }, now)).toBe('closed');
    // Waiting on an opening bound reads as "not yet", past the draw as "over".
    expect(registrationPhase({ ...bounded, opens_at: '2026-08-01T18:00:00.000Z' }, now)).toBe(
      'before',
    );
    expect(registrationPhase({ ...bounded, draw_starts_at: '2026-08-01T16:10:00.000Z' }, now)).toBe(
      'closed',
    );
  });
});
