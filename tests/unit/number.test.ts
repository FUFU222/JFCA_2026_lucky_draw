import { describe, expect, it } from 'vitest';

import { formatRaffleNumber } from '../../lib/raffle/number';

describe('formatRaffleNumber', () => {
  it('formats the first raffle number without padding', () => {
    expect(formatRaffleNumber(BigInt(10_000))).toBe('No. 10000');
  });

  it('does not impose an upper cap on raffle numbers', () => {
    expect(formatRaffleNumber(BigInt(100_000))).toBe('No. 100000');
  });
});
