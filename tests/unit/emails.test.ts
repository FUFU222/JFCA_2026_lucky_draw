import { describe, expect, it } from 'vitest';

import { RAFFLE_EMAIL_SENDER, renderRaffleEmail } from '../../lib/email/templates';

const verificationInput = {
  kind: 'VERIFICATION' as const,
  verificationUrl: 'https://luckydraw.livapon.com/jfca-2026/verify/token-abc',
};

const receiptInput = {
  kind: 'RECEIPT' as const,
  number: BigInt(10_000),
  receiptUrl: 'https://luckydraw.livapon.com/jfca-2026/number/receipt-abc',
};

describe('sender', () => {
  it('is the LIVAPON transactional address', () => {
    expect(RAFFLE_EMAIL_SENDER).toBe('LIVAPON <info@chairman.jp>');
  });
});

describe('verification email', () => {
  it('explains the 24-hour expiry and carries the confirmation link', async () => {
    const email = await renderRaffleEmail(verificationInput);

    expect(email.subject).toBe('Verify your email address');
    expect(email.html).toContain(verificationInput.verificationUrl);
    expect(email.html).toMatch(/24 hours/i);
    expect(email.text).toContain(verificationInput.verificationUrl);
    expect(email.text).toMatch(/24 hours/i);
  });

  it('never promises a number before the address is confirmed', async () => {
    const { html } = await renderRaffleEmail(verificationInput);

    expect(html).not.toMatch(/No\.\s*\d/);
  });
});

describe('receipt email', () => {
  it('shows the exact number and links to the permanent number page', async () => {
    const email = await renderRaffleEmail(receiptInput);

    expect(email.subject).toBe('Your Lucky Draw number');
    expect(email.html).toContain('Your Lucky Draw Number');
    expect(email.html).toContain('No. 10000');
    expect(email.html).toContain(receiptInput.receiptUrl);
    expect(email.text).toContain('No. 10000');
    expect(email.text).toContain(receiptInput.receiptUrl);
  });

  it('renders a large number without grouping or padding', async () => {
    const { html, text } = await renderRaffleEmail({ ...receiptInput, number: BigInt(100_000) });

    expect(html).toContain('No. 100000');
    expect(text).toContain('No. 100000');
    expect(html).not.toContain('100,000');
  });

  it('says nothing about winning or losing', async () => {
    const { html, text } = await renderRaffleEmail(receiptInput);

    for (const forbidden of [/\bwinner\b/i, /\bwon\b/i, /\blose\b/i, /\blosing\b/i]) {
      expect(html).not.toMatch(forbidden);
      expect(text).not.toMatch(forbidden);
    }
  });

  it('does not offer profile editing or a way to request another number', async () => {
    const { html } = await renderRaffleEmail(receiptInput);

    expect(html).not.toMatch(/edit your (profile|details)/i);
    expect(html).not.toMatch(/resend/i);
  });
});
