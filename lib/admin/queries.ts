import 'server-only';

import { createServiceRoleClient } from '../db/server';
import type { Campaign } from '../db/types';
import type { ExportableEntry } from './csv';

export interface DashboardSummary {
  campaign: Campaign;
  verified: number;
  pending: number;
  recentEntries: EntrySummary[];
  failedDeliveries: FailedDelivery[];
  outboxWaiting: number;
}

export interface EntrySummary {
  id: string;
  email: string;
  state: 'PENDING' | 'VERIFIED';
  number: number | null;
  locale: string;
  created_at: string;
  verified_at: string | null;
}

export interface FailedDelivery {
  entryId: string;
  email: string;
  kind: string;
  error: string | null;
  attemptedAt: string;
}

async function countEntries(campaignId: string, state: 'PENDING' | 'VERIFIED') {
  const { count, error } = await createServiceRoleClient()
    .from('raffle_entries')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('state', state);
  if (error) throw error;
  return count ?? 0;
}

export async function loadDashboard(slug: string): Promise<DashboardSummary | null> {
  const client = createServiceRoleClient();
  const { data: campaign, error } = await client
    .from('campaigns')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!campaign) return null;

  const campaignId = (campaign as Campaign).id;
  const [verified, pending, recent, failures, waiting] = await Promise.all([
    countEntries(campaignId, 'VERIFIED'),
    countEntries(campaignId, 'PENDING'),
    client
      .from('raffle_entries')
      .select('id, email, state, number, locale, created_at, verified_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(10),
    client
      .from('email_deliveries')
      .select('entry_id, kind, provider_error, attempted_at, raffle_entries!inner(email, campaign_id)')
      .eq('provider_status', 'FAILED')
      .eq('raffle_entries.campaign_id', campaignId)
      .order('attempted_at', { ascending: false })
      .limit(20),
    client
      .from('email_outbox')
      .select('id', { count: 'exact', head: true })
      .in('status', ['PENDING', 'PROCESSING', 'FAILED']),
  ]);

  if (recent.error) throw recent.error;
  if (failures.error) throw failures.error;

  return {
    campaign: campaign as Campaign,
    verified,
    pending,
    recentEntries: (recent.data ?? []) as EntrySummary[],
    failedDeliveries: ((failures.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const entry = row.raffle_entries as { email: string } | Array<{ email: string }>;
      return {
        entryId: String(row.entry_id),
        email: Array.isArray(entry) ? entry[0]?.email : entry?.email,
        kind: String(row.kind),
        error: (row.provider_error as string | null) ?? null,
        attemptedAt: String(row.attempted_at),
      };
    }),
    outboxWaiting: waiting.count ?? 0,
  };
}

export interface EntrySearch {
  campaignId: string;
  /** An address fragment or an exact issued number. */
  query?: string;
  limit?: number;
}

/**
 * Search is by address or by issued number, the two things a support request
 * ever arrives with.
 */
export async function searchEntries({
  campaignId,
  query,
  limit = 100,
}: EntrySearch): Promise<EntrySummary[]> {
  let request = createServiceRoleClient()
    .from('raffle_entries')
    .select('id, email, state, number, locale, created_at, verified_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const trimmed = query?.trim();
  if (trimmed) {
    const asNumber = /^\d+$/.test(trimmed) ? trimmed : null;
    request = asNumber
      ? request.eq('number', asNumber)
      : // `%` and `_` are wildcards in a pattern match, so a searched address
        // cannot be allowed to carry its own.
        request.ilike('email', `%${trimmed.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
  }

  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as EntrySummary[];
}

export async function exportEntries(campaignId: string): Promise<ExportableEntry[]> {
  const { data, error } = await createServiceRoleClient()
    .from('raffle_entries')
    .select(
      'number, email, state, verified_at, locale, terms_version, terms_consented_at, first_name, last_name, phone, gender, date_of_birth, country, region, created_at',
    )
    .eq('campaign_id', campaignId)
    .order('number', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as ExportableEntry[];
}

export async function setCampaignStatus(
  campaignId: string,
  status: 'SCHEDULED' | 'PAUSED',
): Promise<void> {
  const { error } = await createServiceRoleClient()
    .from('campaigns')
    .update({ status })
    .eq('id', campaignId);
  if (error) throw error;
}
