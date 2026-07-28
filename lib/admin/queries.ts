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
  is_test: boolean;
}

export interface FailedDelivery {
  entryId: string;
  email: string;
  kind: string;
  error: string | null;
  attemptedAt: string;
}

/**
 * `is_test` rows are excluded here — and in every export/count below — so a
 * rehearsal run by an operator never inflates the numbers a real decision
 * gets made from. They still show up in {@link searchEntries} and the
 * dashboard's recent-entries list, badged, so an operator can confirm their
 * own test run actually worked.
 */
async function countEntries(campaignId: string, state: 'PENDING' | 'VERIFIED') {
  const { count, error } = await createServiceRoleClient()
    .from('raffle_entries')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('state', state)
    .eq('is_test', false);
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
      .select('id, email, state, number, locale, created_at, verified_at, is_test')
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
    .select('id, email, state, number, locale, created_at, verified_at, is_test')
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

const EXPORT_COLUMNS =
  'number, email, state, verified_at, locale, terms_version, terms_consented_at, first_name, last_name, phone, gender, date_of_birth, country, region, created_at';
const EXPORT_PAGE_SIZE = 500;

/**
 * Yields the entries a page at a time.
 *
 * PostgREST caps a single response at its `max_rows` setting — 1000 by default
 * — and returns the truncated set with a 200 and no warning, so an unpaginated
 * export of a 30,000-entry event silently produced a file containing the first
 * thousand. The page size is also small enough that the caller can stream the
 * result instead of buffering a file past the platform's response limit.
 */
export async function* exportEntryPages(
  campaignId: string,
  pageSize = EXPORT_PAGE_SIZE,
): AsyncGenerator<ExportableEntry[]> {
  const client = createServiceRoleClient();

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('raffle_entries')
      .select(EXPORT_COLUMNS)
      .eq('campaign_id', campaignId)
      .eq('is_test', false)
      // Ordered by a unique column so pages cannot overlap or skip a row.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    const page = (data ?? []) as ExportableEntry[];
    if (page.length > 0) yield page;
    if (page.length < pageSize) return;
  }
}

export async function countEntriesForExport(campaignId: string): Promise<number> {
  const { count, error } = await createServiceRoleClient()
    .from('raffle_entries')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('is_test', false);
  if (error) throw error;
  return count ?? 0;
}

export async function setCampaignStatus(
  campaignId: string,
  status: 'SCHEDULED' | 'PAUSED' | 'CLOSED',
): Promise<void> {
  const { error } = await createServiceRoleClient()
    .from('campaigns')
    .update({ status })
    .eq('id', campaignId);
  if (error) throw error;
}

/**
 * Used only by the "start entries now" admin action. Opens registration
 * immediately by setting `status` to `SCHEDULED` and, only if `opens_at` is
 * unset or still in the future, bringing it forward to now — an `opens_at`
 * already in the past is left untouched so restarting after a pause does not
 * quietly rewrite when the campaign "really" opened. The caller is
 * responsible for confirming `draw_starts_at` is already set: without it,
 * `isRegistrationOpen()` stays false no matter what this does.
 */
export async function startRegistrationNow(
  campaignId: string,
  currentOpensAt: string | null,
  now: Date = new Date(),
): Promise<void> {
  const opensAtIsFuture =
    currentOpensAt !== null && new Date(currentOpensAt).getTime() > now.getTime();

  const updates: { status: 'SCHEDULED'; opens_at?: string } = { status: 'SCHEDULED' };
  if (currentOpensAt === null || opensAtIsFuture) {
    updates.opens_at = now.toISOString();
  }

  const { error } = await createServiceRoleClient()
    .from('campaigns')
    .update(updates)
    .eq('id', campaignId);
  if (error) throw error;
}
