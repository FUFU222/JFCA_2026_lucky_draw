import { describe, expect, it } from 'vitest';

import {
  emailRequestLimit,
  ipRequestLimit,
  lookupEmailRequestLimit,
  lookupIpRequestLimit,
} from '../../lib/raffle/limits';

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

describe('lookup request limits', () => {
  // A separate bucket pair from the entry form's, on the same two axes, for
  // the same two reasons: the per-IP one has to be generous for a shared
  // venue network, and the per-address one is what actually caps how many
  // times one address's number can be disclosed.
  it('defaults the per-IP allowance as generously as the entry form does', () => {
    expect(lookupIpRequestLimit({})).toBeGreaterThanOrEqual(500);
  });

  it('defaults the per-address allowance tight, since a lookup is a rare single action', () => {
    expect(lookupEmailRequestLimit({})).toBe(5);
  });

  it('can be raised from its own environment variables, independent of the entry form\'s', () => {
    expect(lookupIpRequestLimit({ RAFFLE_LOOKUP_IP_REQUEST_LIMIT: '2000' })).toBe(2000);
    expect(lookupEmailRequestLimit({ RAFFLE_LOOKUP_EMAIL_REQUEST_LIMIT: '8' })).toBe(8);
    // Confirms the two limit pairs are read from genuinely different
    // variables: setting one's must not move the other's.
    expect(ipRequestLimit({ RAFFLE_LOOKUP_IP_REQUEST_LIMIT: '2000' })).toBeGreaterThanOrEqual(500);
    expect(lookupIpRequestLimit({ RAFFLE_IP_REQUEST_LIMIT: '2000' })).toBeGreaterThanOrEqual(500);
  });

  it('ignores a value that is not a positive whole number rather than disabling the limit', () => {
    for (const bad of ['0', '-1', 'many', '1.5', '']) {
      expect(lookupIpRequestLimit({ RAFFLE_LOOKUP_IP_REQUEST_LIMIT: bad }), bad).toBe(1000);
      expect(lookupEmailRequestLimit({ RAFFLE_LOOKUP_EMAIL_REQUEST_LIMIT: bad }), bad).toBe(5);
    }
  });
});
