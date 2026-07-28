import { Body, Container, Head, Heading, Html, Img, Link, Preview, Section, Text } from 'react-email';

import { emailStyles, type EmailLocale } from './styles';
import { LOGO_ALT, logoUrl } from './logo';

const copy = {
  en: {
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
  },
  ja: {
    preview: '抽選番号のお知らせ',
    heading: 'ご応募を受け付けました',
    label: 'Your Lucky Draw Number',
    keep: 'この番号をお控えください。スクリーンショットでの保存がおすすめです。',
    venue: '抽選結果は会場で発表されます。上記のお客様の番号とお照らし合わせください。',
    pageIntro: '番号確認ページはいつでもご覧いただけます。',
    contact: '番号がわからなくなった場合は',
    contactTail: 'までご連絡ください。応募内容を確認のうえ、2〜3日以内にご回答します。',
    operator: 'LIVAPON は株式会社CHAIRMAN が運営しています。',
    why: 'このメールは、Japan Festival Canada 2026 の Lucky Draw にこのアドレスでご応募いただいたためお送りしています。',
  },
} as const;

export interface NumberReceiptEmailProps {
  locale: EmailLocale;
  /** Already formatted as `No. 10000` by the caller. */
  formattedNumber: string;
  receiptUrl: string;
  supportEmail: string;
}

export function NumberReceiptEmail({
  locale,
  formattedNumber,
  receiptUrl,
  supportEmail,
}: NumberReceiptEmailProps) {
  const t = copy[locale];

  return (
    <Html lang={locale}>
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
  locale: 'en',
  formattedNumber: 'No. 10000',
  receiptUrl: 'https://luckydraw.livapon.com/jfca-2026/number/preview-token',
  supportEmail: 'info@chairman.jp',
} satisfies NumberReceiptEmailProps;

export default NumberReceiptEmail;
