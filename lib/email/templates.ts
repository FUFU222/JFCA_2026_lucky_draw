import { render } from 'react-email';

import { NumberReceiptEmail } from '../../emails/number-receipt-email';
import { VerificationEmail } from '../../emails/verification-email';
import { formatRaffleNumber } from '../raffle/number';

export const RAFFLE_EMAIL_SENDER = 'LIVAPON <info@chairman.jp>';
export const RAFFLE_SUPPORT_EMAIL = 'info@chairman.jp';

export type RaffleEmailKind = 'VERIFICATION' | 'RECEIPT';

export type RaffleEmailInput =
  | { kind: 'VERIFICATION'; verificationUrl: string }
  | { kind: 'RECEIPT'; number: bigint; receiptUrl: string };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const subjects = {
  VERIFICATION: 'Verify your email address',
  RECEIPT: 'Your Lucky Draw number',
} as const;

export async function renderRaffleEmail(input: RaffleEmailInput): Promise<RenderedEmail> {
  const element =
    input.kind === 'VERIFICATION' ? (
      VerificationEmail({
        verificationUrl: input.verificationUrl,
        supportEmail: RAFFLE_SUPPORT_EMAIL,
      })
    ) : (
      NumberReceiptEmail({
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

  return { subject: subjects[input.kind], html, text };
}
