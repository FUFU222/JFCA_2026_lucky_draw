export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'PAUSED' | 'CLOSED';

export type EntryState = 'PENDING' | 'VERIFIED';
/**
 * The public side is English-only; the column and this type stay because the
 * admin CSV export and the entries table still show it, and narrowing the DB
 * constraint (rather than dropping the column) is the lower-risk change.
 */
export type EntryLocale = 'en';

export interface Campaign {
  id: string;
  slug: string;
  title: string;
  opens_at: string | null;
  draw_starts_at: string | null;
  status: CampaignStatus;
  next_number: number;
  /** Counter for test-mode entries — see `is_test` on {@link RaffleEntry}. */
  test_next_number: number;
  terms_version: string;
  created_at: string;
  updated_at: string;
}

export type CampaignSchedule = Pick<
  Campaign,
  'status' | 'opens_at' | 'draw_starts_at'
>;

export interface RaffleEntry {
  id: string;
  campaign_id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  country?: string | null;
  region?: string | null;
  locale: EntryLocale;
  terms_version: string;
  terms_consented_at: string;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  state: EntryState;
  number: number | null;
  verified_at: string | null;
  receipt_token_hash: string | null;
  /**
   * Set only by an authenticated operator rehearsing the public flow
   * (`RaffleService.requestVerification`/`resendVerification` re-verify the
   * operator session server-side; a client cannot set this on its own).
   * Issued a number from `campaigns.test_next_number` instead of
   * `next_number`, and excluded from every admin count and export.
   */
  is_test: boolean;
  created_at: string;
  updated_at: string;
}
