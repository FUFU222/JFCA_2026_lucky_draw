import { Body, Container, Head, Heading, Html, Img, Link, Preview, Section, Text } from 'react-email';

import { emailStyles } from './styles';
import { LOGO_ALT, logoUrl } from './logo';

const copy = {
  preview: 'Your Lucky Draw number',
  heading: 'Your entry is confirmed',
  label: 'Your Lucky Draw Number',
  keep: 'Save this number. A screenshot is the easiest way to keep it.',
  venue: 'Drawn numbers are announced at the venue. Compare them with the number above.',
  pageIntro: 'You can open your number again at any time:',
  contact: 'Lost your number? Contact',
  contactTail: 'and an operator will look it up.',
  operator: 'LIVAPON is operated by CHAIRMAN Inc.',
  why: 'You are receiving this because this address was entered into the Lucky Draw at Japan Festival Canada 2026.',
} as const;

export interface NumberReceiptEmailProps {
  /** Already formatted as `No. 10000` by the caller. */
  formattedNumber: string;
  receiptUrl: string;
  supportEmail: string;
}

export function NumberReceiptEmail({
  formattedNumber,
  receiptUrl,
  supportEmail,
}: NumberReceiptEmailProps) {
  const t = copy;

  return (
    <Html lang="en">
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.container}>
          <Img src={logoUrl()} alt={LOGO_ALT} width="140" style={emailStyles.logo} />
          <Heading style={emailStyles.heading}>{t.heading}</Heading>

          {/* The number is the entire point of this message, so it is the one
              element that must survive a glance on a phone at a venue. */}
          <Section style={emailStyles.numberPanel}>
            <Text style={emailStyles.numberLabel}>{t.label}</Text>
            <Text style={emailStyles.number}>{formattedNumber}</Text>
          </Section>

          <Text style={emailStyles.paragraph}>{t.keep}</Text>
          <Text style={emailStyles.paragraph}>{t.venue}</Text>

          <Text style={emailStyles.muted}>{t.pageIntro}</Text>
          <Text style={emailStyles.url}>
            <Link href={receiptUrl} style={emailStyles.urlLink}>
              {receiptUrl}
            </Link>
          </Text>

          <Text style={emailStyles.muted}>
            {t.contact}{' '}
            <Link href={`mailto:${supportEmail}`} style={emailStyles.urlLink}>
              {supportEmail}
            </Link>{' '}
            {t.contactTail}
          </Text>

          <Section style={emailStyles.footer}>
            <Text style={emailStyles.footerText}>{t.operator}</Text>
            <Text style={emailStyles.footerText}>{t.why}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Sample data for `pnpm email:preview` and `pnpm email:export`.
NumberReceiptEmail.PreviewProps = {
  formattedNumber: 'No. 10000',
  receiptUrl: 'https://luckydraw.livapon.com/jfca-2026/number/preview-token',
  supportEmail: 'info@chairman.jp',
} satisfies NumberReceiptEmailProps;

export default NumberReceiptEmail;
