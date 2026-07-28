import 'server-only';

import { createServiceRoleClient } from './server';
import type { Campaign } from './types';
import { hashToken } from '../raffle/tokens';
import type { Locale } from '../i18n/messages';

/**
 * Read-only lookups for the public pages. Nothing here mutates: opening an
 * emailed link must never issue a number, because a mail scanner following the
 * URL would then consume it.
 */

export async function findCampaign(slug: string): Promise<Campaign | null> {
  const { data, error } = await createServiceRoleClient()
    .from('campaigns')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data as Campaign | null;
}

export type VerificationLinkState = 'usable' | 'unusable';

/**
 * Answers only whether the confirmation page should offer its action. It
 * deliberately reveals nothing else, and the same `unusable` covers an unknown,
 * expired, consumed, and wrong-event link.
 */
export async function verificationLinkState(
  eventSlug: string,
  rawToken: string,
): Promise<VerificationLinkState> {
  const { data, error } = await createServiceRoleClient()
    .from('verification_tokens')
    .select('expires_at, consumed_at, raffle_entries!inner(campaigns!inner(slug))')
    .eq('token_hash', hashToken(rawToken))
    .maybeSingle();
  if (error) throw error;
  if (!data) return 'unusable';

  const row = data as {
    expires_at: string;
    consumed_at: string | null;
    raffle_entries: { campaigns: { slug: string } | { slug: string }[] } | Array<{ campaigns: { slug: string } | { slug: string }[] }>;
  };

  const entry = Array.isArray(row.raffle_entries) ? row.raffle_entries[0] : row.raffle_entries;
  const campaign = Array.isArray(entry?.campaigns) ? entry.campaigns[0] : entry?.campaigns;
  if (campaign?.slug !== eventSlug) return 'unusable';
  if (row.consumed_at !== null) return 'unusable';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'unusable';

  return 'usable';
}

export interface ReceiptView {
  number: bigint;
  locale: Locale;
}

/** Looks a receipt up by the hash of its token; the token itself is never stored. */
export async function findReceipt(
  eventSlug: string,
  rawReceiptToken: string,
): Promise<ReceiptView | null> {
  const { data, error } = await createServiceRoleClient()
    .from('raffle_entries')
    .select('number, locale, campaigns!inner(slug)')
    .eq('receipt_token_hash', hashToken(rawReceiptToken))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as {
    number: number | string | null;
    locale: Locale;
    campaigns: { slug: string } | { slug: string }[];
  };
  const campaign = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
  if (campaign?.slug !== eventSlug || row.number === null) return null;

  return { number: BigInt(row.number), locale: row.locale };
}
