import { describe, expect, it } from 'vitest';

import { RAFFLE_EMAIL_SENDER, renderRaffleEmail } from '../../lib/email/templates';

const verificationInput = {
  kind: 'VERIFICATION' as const,
  locale: 'en' as const,
  verificationUrl: 'https://luckydraw.livapon.com/jfca-2026/verify/token-abc',
};

const receiptInput = {
  kind: 'RECEIPT' as const,
  locale: 'en' as const,
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
    const english = await renderRaffleEmail(verificationInput);

    expect(english.subject).toBe('Verify your email address');
    expect(english.html).toContain(verificationInput.verificationUrl);
    expect(english.html).toMatch(/24 hours/i);
    expect(english.text).toContain(verificationInput.verificationUrl);
    expect(english.text).toMatch(/24 hours/i);
  });

  it('renders Japanese for a Japanese entry', async () => {
    const japanese = await renderRaffleEmail({ ...verificationInput, locale: 'ja' });

    expect(japanese.subject).toBe('メールアドレスの確認');
    expect(japanese.html).toContain('24時間');
    expect(japanese.html).toContain(verificationInput.verificationUrl);
  });

  it('never promises a number before the address is confirmed', async () => {
    const { html } = await renderRaffleEmail(verificationInput);

    expect(html).not.toMatch(/No\.\s*\d/);
  });
});

describe('receipt email', () => {
  it('shows the exact number and links to the permanent number page', async () => {
    const english = await renderRaffleEmail(receiptInput);

    expect(english.subject).toBe('Your Lucky Draw number');
    expect(english.html).toContain('Your Lucky Draw Number');
    expect(english.html).toContain('No. 10000');
    expect(english.html).toContain(receiptInput.receiptUrl);
    expect(english.text).toContain('No. 10000');
    expect(english.text).toContain(receiptInput.receiptUrl);
  });

  it('renders a large number without grouping or padding', async () => {
    const { html, text } = await renderRaffleEmail({ ...receiptInput, number: BigInt(100_000) });

    expect(html).toContain('No. 100000');
    expect(text).toContain('No. 100000');
    expect(html).not.toContain('100,000');
  });

  it('renders Japanese for a Japanese entry and still shows the number in one form', async () => {
    const japanese = await renderRaffleEmail({ ...receiptInput, locale: 'ja' });

    expect(japanese.subject).toBe('抽選番号のお知らせ');
    expect(japanese.html).toContain('No. 10000');
    expect(japanese.html).toContain('会場');
  });

  it('says nothing about winning or losing', async () => {
    for (const locale of ['en', 'ja'] as const) {
      const { html, text } = await renderRaffleEmail({ ...receiptInput, locale });

      for (const forbidden of [/\bwinner\b/i, /\bwon\b/i, /\blose\b/i, /\blosing\b/i, /当選/, /落選/, /はずれ/]) {
        expect(html).not.toMatch(forbidden);
        expect(text).not.toMatch(forbidden);
      }
    }
  });

  it('does not offer profile editing or a way to request another number', async () => {
    const { html } = await renderRaffleEmail(receiptInput);

    expect(html).not.toMatch(/edit your (profile|details)/i);
    expect(html).not.toMatch(/resend/i);
  });
});
