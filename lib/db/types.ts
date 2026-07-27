export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'PAUSED' | 'CLOSED';

export type EntryState = 'PENDING' | 'VERIFIED';
export type EntryLocale = 'en' | 'ja';

export interface Campaign {
  id: string;
  slug: string;
  title: string;
  opens_at: string | null;
  draw_starts_at: string | null;
  status: CampaignStatus;
  next_number: bigint;
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
  locale: EntryLocale;
  terms_version: string;
  terms_consented_at: string;
  state: EntryState;
  number: bigint | null;
  verified_at: string | null;
  receipt_token_hash: string | null;
  created_at: string;
  updated_at: string;
}
