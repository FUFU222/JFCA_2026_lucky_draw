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

const TERMS: readonly TermsSection[] = [
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
];

export function luckyDrawTerms(): readonly TermsSection[] {
  return TERMS;
}
