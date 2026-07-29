export const PRIVACY_POLICY_URL = 'https://livapon.com/policies/privacy-policy';
export const SUPPORT_EMAIL = 'info@chairman.jp';

/**
 * The version of the wording *in this file*.
 *
 * What actually gets recorded against an entry is `campaigns.terms_version`
 * from the database — this constant is not read on that path. The two are
 * meant to agree, and nothing but care keeps them agreeing, so the admin
 * dashboard compares them and says so when they drift. Change this in the same
 * commit as the text below, and update the campaign row to match.
 */
export const LUCKY_DRAW_TERMS_VERSION = 'jfca-2026-terms-v1';

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
      'Your address is used to confirm your entry and to send your number. That is all entering requires.',
      'LIVAPON news and offers are a separate, optional choice on the entry form. Leaving it unticked does not affect your entry. If you do tick it, every message includes a way to stop receiving them.',
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
