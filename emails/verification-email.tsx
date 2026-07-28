import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text } from 'react-email';

import { emailStyles, type EmailLocale } from './styles';

const copy = {
  en: {
    preview: 'Confirm your email to receive your Lucky Draw number',
    heading: 'Confirm your email address',
    intro:
      'Thank you for entering the LIVAPON Lucky Draw. Confirm this address to receive your Lucky Draw number.',
    action: 'Confirm my email address',
    expiry: 'This link works for 24 hours. After that, submit the entry form again to get a new one.',
    fallback: 'If the button does not work, open this address in your browser:',
    ignore: 'If you did not enter the Lucky Draw, you can ignore this message.',
    contact: 'Questions:',
    operator: 'LIVAPON is operated by CHAIRMAN Inc.',
    why: 'You are receiving this because this address was entered into the Lucky Draw at Japan Festival Canada 2026.',
  },
  ja: {
    preview: '抽選番号を受け取るにはメールアドレスの確認が必要です',
    heading: 'メールアドレスをご確認ください',
    intro:
      'LIVAPON Lucky Draw へのご応募ありがとうございます。抽選番号をお受け取りいただくため、下のボタンからメールアドレスのご確認をお願いします。',
    action: 'メールアドレスを確認する',
    expiry:
      'このリンクは24時間有効です。期限を過ぎた場合は、応募フォームからあらためてご応募ください。',
    fallback: 'ボタンが動作しない場合は、次のアドレスをブラウザで開いてください。',
    ignore: 'お心当たりがない場合は、このメールを破棄してください。',
    contact: 'お問い合わせ先:',
    operator: 'LIVAPON は株式会社CHAIRMAN が運営しています。',
    why: 'このメールは、Japan Festival Canada 2026 の Lucky Draw にこのアドレスでご応募いただいたためお送りしています。',
  },
} as const;

export interface VerificationEmailProps {
  locale: EmailLocale;
  verificationUrl: string;
  supportEmail: string;
}

export function VerificationEmail({ locale, verificationUrl, supportEmail }: VerificationEmailProps) {
  const t = copy[locale];

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.container}>
          <Text style={emailStyles.brand}>LIVAPON</Text>
          <Heading style={emailStyles.heading}>{t.heading}</Heading>
          <Text style={emailStyles.paragraph}>{t.intro}</Text>

          <Section style={emailStyles.actionSection}>
            <Link href={verificationUrl} style={emailStyles.button}>
              {t.action}
            </Link>
          </Section>

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
  locale: 'en',
  verificationUrl: 'https://luckydraw.livapon.com/jfca-2026/verify/preview-token',
  supportEmail: 'info@chairman.jp',
} satisfies VerificationEmailProps;

export default VerificationEmail;
