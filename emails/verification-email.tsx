import { Body, Container, Head, Heading, Html, Img, Link, Preview, Section, Text } from 'react-email';

import { emailStyles } from './styles';
import { LOGO_ALT, logoUrl } from './logo';

/**
 * This is now the only message the Lucky Draw sends, which changes what it is
 * for. It was a step to get past; it is also the visitor's durable copy of
 * their number, because once a number has been issued this same link returns
 * to it for good (`issuedReceiptToken`). So it says to keep the message, and it
 * separates the deadline — 24 hours to claim — from the link's own lifetime,
 * which has none.
 */
const copy = {
  preview: 'Confirm your email to get your Lucky Draw number',
  heading: 'Confirm your email address',
  intro:
    'Thank you for entering the LIVAPON Lucky Draw. Confirm this address to get your Lucky Draw number.',
  action: 'Confirm my email address',
  keep: 'Keep this email. After you have your number, this same link brings it back any time — it is the easiest way to find your number again.',
  expiry: 'Confirm within 24 hours. After that, submit the entry form again to get a new link.',
  fallback: 'If the button does not work, open this address in your browser:',
  ignore: 'If you did not enter the Lucky Draw, you can ignore this message.',
  contact: 'Questions:',
  operator: 'LIVAPON is operated by CHAIRMAN Inc.',
  why: 'You are receiving this because this address was entered into the Lucky Draw at Japan Festival Canada 2026.',
} as const;

export interface VerificationEmailProps {
  verificationUrl: string;
  supportEmail: string;
}

export function VerificationEmail({ verificationUrl, supportEmail }: VerificationEmailProps) {
  const t = copy;

  return (
    <Html lang="en">
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.container}>
          <Img src={logoUrl()} alt={LOGO_ALT} width="140" style={emailStyles.logo} />
          <Heading style={emailStyles.heading}>{t.heading}</Heading>
          <Text style={emailStyles.paragraph}>{t.intro}</Text>

          <Section style={emailStyles.actionSection}>
            <Link href={verificationUrl} style={emailStyles.button}>
              {t.action}
            </Link>
          </Section>

          <Text style={emailStyles.paragraph}>{t.keep}</Text>
          <Text style={emailStyles.paragraph}>{t.expiry}</Text>

          <Text style={emailStyles.muted}>{t.fallback}</Text>
          <Text style={emailStyles.url}>
            <Link href={verificationUrl} style={emailStyles.urlLink}>
              {verificationUrl}
            </Link>
          </Text>

          <Text style={emailStyles.muted}>{t.ignore}</Text>
          <Text style={emailStyles.muted}>
            {t.contact}{' '}
            <Link href={`mailto:${supportEmail}`} style={emailStyles.urlLink}>
              {supportEmail}
            </Link>
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
VerificationEmail.PreviewProps = {
  verificationUrl: 'https://luckydraw.livapon.com/jfca-2026/verify/preview-token',
  supportEmail: 'info@chairman.jp',
} satisfies VerificationEmailProps;

export default VerificationEmail;
