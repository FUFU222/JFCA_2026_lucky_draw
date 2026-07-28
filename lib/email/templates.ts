import { render } from 'react-email';

import { NumberReceiptEmail } from '../../emails/number-receipt-email';
import { VerificationEmail } from '../../emails/verification-email';
import type { EmailLocale } from '../../emails/styles';
import { formatRaffleNumber } from '../raffle/number';

export const RAFFLE_EMAIL_SENDER = 'LIVAPON <info@chairman.jp>';
export const RAFFLE_SUPPORT_EMAIL = 'info@chairman.jp';

export type RaffleEmailKind = 'VERIFICATION' | 'RECEIPT';

export type RaffleEmailInput =
  | { kind: 'VERIFICATION'; locale: EmailLocale; verificationUrl: string }
  | { kind: 'RECEIPT'; locale: EmailLocale; number: bigint; receiptUrl: string };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const subjects = {
  VERIFICATION: { en: 'Verify your email address', ja: 'メールアドレスの確認' },
  RECEIPT: { en: 'Your Lucky Draw number', ja: '抽選番号のお知らせ' },
} as const;

export async function renderRaffleEmail(input: RaffleEmailInput): Promise<RenderedEmail> {
  const element =
    input.kind === 'VERIFICATION' ? (
      VerificationEmail({
        locale: input.locale,
        verificationUrl: input.verificationUrl,
        supportEmail: RAFFLE_SUPPORT_EMAIL,
      })
    ) : (
      NumberReceiptEmail({
        locale: input.locale,
        formattedNumber: formatRaffleNumber(input.number),
        receiptUrl: input.receiptUrl,
        supportEmail: RAFFLE_SUPPORT_EMAIL,
      })
    );

  // A plain-text part is always sent alongside the HTML: some clients render it
  // instead, and a receipt whose number only exists in HTML is useless there.
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject: subjects[input.kind][input.locale], html, text };
}
