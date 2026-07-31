import { describe, expect, it } from 'vitest';

import { TICKET_HEIGHT, TICKET_WIDTH, ticketFileName } from '../../lib/raffle/ticket-canvas';

describe('ticketFileName', () => {
  it('is a plain filename, not the "No. 10000" display string', () => {
    // formatRaffleNumber() renders "No. 10000" for display; that space and
    // period would land in the saved file's name verbatim if used here.
    expect(ticketFileName(BigInt(10_000))).toBe('lucky-draw-10000.png');
  });

  it('holds for a test-mode number too', () => {
    expect(ticketFileName(BigInt(900_000_001))).toBe('lucky-draw-900000001.png');
  });
});

describe('ticket geometry', () => {
  it('is a 2:1 box, matching the aspect-[2/1] class the component renders it at', () => {
    expect(TICKET_WIDTH / TICKET_HEIGHT).toBe(2);
  });
});
