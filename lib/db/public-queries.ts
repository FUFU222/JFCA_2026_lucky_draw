import 'server-only';

import { createServiceRoleClient } from './server';
import type { Campaign } from './types';
import { hashToken } from '../raffle/tokens';

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

export type VerificationLinkState = 'usable' | 'unusable' | 'event_over';

type LinkCampaign = { slug: string; status: string; draw_starts_at: string | null };
type Nested<T> = T | T[];

function first<T>(value: Nested<T> | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Answers only whether the confirmation page should offer its action. It
 * deliberately reveals nothing else, and the same `unusable` covers an unknown,
 * expired, consumed, and wrong-event link.
 *
 * `event_over` is the exception, because there the honest answer is a
 * different one. A link that is still perfectly good, but belongs to a
 * campaign an operator has closed, used to render the button, fail with RD001,
 * and tell its holder the link had expired and to enter again — which then met
 * "Entries are closed." Now that closing is the one and only way this event
 * ends, that is not an edge case: it is what every unconfirmed entrant is told
 * at the same moment. The condition mirrors the gate inside
 * `confirm_raffle_verification`, rehearsal exemption included, and it is
 * checked in the same order the RPC checks it — after "already used", before
 * "expired" — because a link that is both expired and belongs to a closed
 * event is still someone whose event is over, and sending them back to the
 * form would rebuild the double wall this exists to remove.
 */
export async function verificationLinkState(
  eventSlug: string,
  rawToken: string,
): Promise<VerificationLinkState> {
  const { data, error } = await createServiceRoleClient()
    .from('verification_tokens')
    .select(
      'expires_at, consumed_at, raffle_entries!inner(is_test, campaigns!inner(slug, status, draw_starts_at))',
    )
    .eq('token_hash', hashToken(rawToken))
    .maybeSingle();
  if (error) throw error;
  if (!data) return 'unusable';

  const row = data as {
    expires_at: string;
    consumed_at: string | null;
    raffle_entries: Nested<{ is_test: boolean; campaigns: Nested<LinkCampaign> }>;
  };

  const entry = first(row.raffle_entries);
  const campaign = first(entry?.campaigns);
  if (campaign?.slug !== eventSlug) return 'unusable';
  if (row.consumed_at !== null) return 'unusable';

  // A rehearsal is exempt for the same reason it is exempt in the RPC: the
  // operator needs the journey to work outside the window visitors get.
  if (entry?.is_test !== true) {
    const drawStartsAt = campaign.draw_starts_at;
    const drawBegun = drawStartsAt !== null && new Date(drawStartsAt).getTime() <= Date.now();
    if (campaign.status === 'CLOSED' || campaign.status === 'DRAFT' || drawBegun) {
      return 'event_over';
    }
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) return 'unusable';

  return 'usable';
}

export interface ReceiptView {
  number: bigint;
}

/** Looks a receipt up by the hash of its token; the token itself is never stored. */
export async function findReceipt(
  eventSlug: string,
  rawReceiptToken: string,
): Promise<ReceiptView | null> {
  const { data, error } = await createServiceRoleClient()
    .from('raffle_entries')
    .select('number, campaigns!inner(slug)')
    .eq('receipt_token_hash', hashToken(rawReceiptToken))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as {
    number: number | string | null;
    campaigns: { slug: string } | { slug: string }[];
  };
  const campaign = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
  if (campaign?.slug !== eventSlug || row.number === null) return null;

  return { number: BigInt(row.number) };
}
