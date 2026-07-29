import { describe, expect, it } from 'vitest';

import {
  LoggingRaffleMailer,
  createRaffleMailer,
  parseMailDeliveryMode,
} from '../../lib/email/mailer';
import { raffleEmailLink } from '../../lib/email/resend';

describe('parseMailDeliveryMode', () => {
  it('defaults to sending and accepts the two documented modes', () => {
    expect(parseMailDeliveryMode(undefined)).toBe('send');
    expect(parseMailDeliveryMode('send')).toBe('send');
    expect(parseMailDeliveryMode('log')).toBe('log');
  });

  it('refuses an unrecognized mode instead of guessing', () => {
    expect(() => parseMailDeliveryMode('silent')).toThrow('MAIL_DELIVERY_MODE');
  });

  it('tolerates the trailing newline a dashboard paste commonly leaves', () => {
    expect(parseMailDeliveryMode('send\n')).toBe('send');
    expect(parseMailDeliveryMode(' log ')).toBe('log');
  });
});

describe('createRaffleMailer', () => {
  it('refuses log mode in production, where it would swallow every message', () => {
    expect(() => createRaffleMailer('log', true)).toThrow(
      'MAIL_DELIVERY_MODE=log is refused in production',
    );
  });

  it('allows log mode outside production', () => {
    expect(createRaffleMailer('log', false)).toBeInstanceOf(LoggingRaffleMailer);
  });
});

describe('LoggingRaffleMailer', () => {
  it('renders the real templates and records a delivery without a provider', async () => {
    const mailer = new LoggingRaffleMailer('https://luckydraw.livapon.com', () => {});

    await mailer.sendVerification({
      eventSlug: 'jfca-2026',
      email: 'person@example.com',
      token: 'verification-token',
    });
    await mailer.sendReceipt({
      eventSlug: 'jfca-2026',
      email: 'person@example.com',
      number: BigInt(10_000),
      receiptToken: 'receipt-token',
    });

    expect(mailer.sent).toEqual([
      {
        kind: 'VERIFICATION',
        to: 'person@example.com',
        subject: 'Verify your email address',
        url: 'https://luckydraw.livapon.com/jfca-2026/verify/verification-token',
      },
      {
        kind: 'RECEIPT',
        to: 'person@example.com',
        subject: 'Your Lucky Draw number',
        url: 'https://luckydraw.livapon.com/jfca-2026/number/receipt-token',
      },
    ]);
  });
});

describe('raffleEmailLink', () => {
  it('builds one clean URL regardless of a trailing slash on the base', () => {
    expect(raffleEmailLink('https://example.test/', 'jfca-2026', 'verify', 'abc')).toBe(
      'https://example.test/jfca-2026/verify/abc',
    );
    expect(raffleEmailLink('https://example.test', 'jfca-2026', 'number', 'abc')).toBe(
      'https://example.test/jfca-2026/number/abc',
    );
  });

  it('escapes a token so it cannot alter the path', () => {
    expect(raffleEmailLink('https://example.test', 'jfca-2026', 'verify', 'a/b?c')).toBe(
      'https://example.test/jfca-2026/verify/a%2Fb%3Fc',
    );
  });
});
