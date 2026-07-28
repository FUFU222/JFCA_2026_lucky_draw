import { describe, expect, it } from 'vitest';

import { emailRequestLimit, ipRequestLimit } from '../../lib/raffle/limits';

describe('request limits', () => {
  it('defaults the per-IP allowance high enough for a shared venue network', () => {
    // Hundreds of visitors behind one wifi or carrier NAT share an address.
    expect(ipRequestLimit({})).toBeGreaterThanOrEqual(500);
  });

  it('keeps the per-address allowance tight, because that is the one that protects a person', () => {
    expect(emailRequestLimit({})).toBe(5);
  });

  it('can be raised from the environment during an event', () => {
    expect(ipRequestLimit({ RAFFLE_IP_REQUEST_LIMIT: '2000' })).toBe(2000);
    expect(emailRequestLimit({ RAFFLE_EMAIL_REQUEST_LIMIT: '8' })).toBe(8);
  });

  it('ignores a value that is not a positive whole number rather than disabling the limit', () => {
    for (const bad of ['0', '-1', 'many', '1.5', '']) {
      expect(ipRequestLimit({ RAFFLE_IP_REQUEST_LIMIT: bad }), bad).toBe(500);
    }
  });
});
