import type { Locale } from '../i18n/messages';

export const PRIVACY_POLICY_URL = 'https://livapon.com/policies/privacy-policy';
export const SUPPORT_EMAIL = 'info@chairman.jp';

/**
 * The version recorded against every entry's consent. It matches the value the
 * seed writes to `campaigns.terms_version`.
 *
 * The clauses below are the ones the service design states. The wording still
 * needs legal sign-off before public registration opens; when the final text
 * lands, bump this version and `supabase/seed.sql` together so an entry's
 * consent always points at the text that was shown.
 */
export const LUCKY_DRAW_TERMS_VERSION = 'jfca-2026-terms-v1-placeholder';

export interface TermsSection {
  heading: string;
  paragraphs: readonly string[];
}

const TERMS: Record<Locale, readonly TermsSection[]> = {
  en: [
    {
      heading: 'Who can enter',
      paragraphs: [
        'One entry per person. Entries made with several email addresses by the same person may be removed.',
        'Entrants under 13 must enter using a parent or guardian’s email address.',
      ],
    },
    {
      heading: 'Your number',
      paragraphs: [
        'A number is issued once your email address is confirmed, and it does not change for this event.',
        'Results are announced at the venue. This service does not decide or report whether an entry has won.',
      ],
    },
    {
      heading: 'Prizes',
      paragraphs: [
        'Prize names, quantities, conditions, and collection are not published here. Follow the guidance given at the venue.',
      ],
    },
    {
      heading: 'Your email address',
      paragraphs: [
        'Your address is used to confirm your entry and to send your number.',
        'It is also used to send you LIVAPON news and campaign information. Every message includes a way to stop receiving them.',
        'Personal information is handled as described in the LIVAPON Privacy Policy.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [
        `Questions about this Lucky Draw, including a number you can no longer find, go to ${SUPPORT_EMAIL}.`,
        'These terms apply to this Lucky Draw only and are separate from the LIVAPON store terms.',
      ],
    },
  ],
  ja: [
    {
      heading: '応募資格',
      paragraphs: [
        'お一人につき1口までとさせていただきます。同じ方が複数のメールアドレスで応募された場合、無効とすることがあります。',
        '13歳未満の方は、保護者の方のメールアドレスでご応募ください。',
      ],
    },
    {
      heading: '抽選番号について',
      paragraphs: [
        'メールアドレスの確認が完了した時点で番号を発行します。本イベントの間、番号は変わりません。',
        '抽選結果は会場で発表されます。本サービスでは当落の判定・通知は行いません。',
      ],
    },
    {
      heading: '景品について',
      paragraphs: [
        '景品名・本数・当選条件・受け取り方法は本サービスに掲載しません。会場でのご案内に従ってください。',
      ],
    },
    {
      heading: 'メールアドレスの利用',
      paragraphs: [
        'ご応募の確認と抽選番号のお知らせに利用します。',
        'あわせて、LIVAPON からのご案内・キャンペーン情報の配信にも利用します。配信は各メールから停止いただけます。',
        '個人情報の取り扱いは LIVAPON プライバシーポリシーに従います。',
      ],
    },
    {
      heading: 'お問い合わせ',
      paragraphs: [
        `本 Lucky Draw に関するお問い合わせ、および番号がわからなくなった場合のご連絡は ${SUPPORT_EMAIL} までお願いします。`,
        '本規約は本 Lucky Draw にのみ適用され、LIVAPON ストアの利用規約とは別のものです。',
      ],
    },
  ],
};

export function luckyDrawTerms(locale: Locale): readonly TermsSection[] {
  return TERMS[locale];
}
