import { notFound } from 'next/navigation';

import { AdminShell, StatCard } from '../../components/admin/admin-shell';
import { CampaignControls } from '../../components/admin/campaign-controls';
import { ACTIVE_CAMPAIGN_SLUG, registrationPhase } from '../../lib/campaign/config';
import { loadDashboard } from '../../lib/admin/queries';
import { requireOperatorSession } from '../../lib/security/operator-session';

export const dynamic = 'force-dynamic';

const PHASE_LABEL = {
  before: 'Not open yet',
  open: 'Accepting entries',
  closed: 'Closed',
} as const;

export default async function AdminDashboard() {
  const operator = await requireOperatorSession();
  const dashboard = await loadDashboard(ACTIVE_CAMPAIGN_SLUG);
  if (!dashboard) notFound();

  const { campaign, verified, pending, recentEntries, failedDeliveries, outboxWaiting } = dashboard;

  return (
    <AdminShell operatorEmail={operator.email} title={campaign.title}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Verified entries" value={verified} />
        <StatCard label="Awaiting confirmation" value={pending} />
        <StatCard label="Next number" value={campaign.next_number} />
        <StatCard label="Emails waiting to send" value={outboxWaiting} />
      </div>

      <section className="mt-10 space-y-4">
        <h2 className="text-lg font-bold text-neutral-900">Registration</h2>
        <dl className="grid gap-2 text-[15px] sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-neutral-600">State</dt>
            <dd className="font-semibold text-neutral-900">
              {PHASE_LABEL[registrationPhase(campaign)]} ({campaign.status})
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-neutral-600">Opens</dt>
            <dd className="font-mono text-neutral-900">{campaign.opens_at ?? 'not set'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-neutral-600">Draw starts</dt>
            <dd className="font-mono text-neutral-900">{campaign.draw_starts_at ?? 'not set'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-neutral-600">Terms version</dt>
            <dd className="font-mono text-neutral-900">{campaign.terms_version}</dd>
          </div>
        </dl>
        <CampaignControls status={campaign.status} />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-lg font-bold text-neutral-900">Recent entries</h2>
        {recentEntries.length === 0 ? (
          <p className="text-[15px] text-neutral-600">No entries yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
            {recentEntries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                <span className="font-mono text-sm tabular-nums text-neutral-900">
                  {entry.number ?? '—'}
                </span>
                <span className="text-[15px] text-neutral-900">{entry.email}</span>
                <span className="text-sm text-neutral-500">{entry.state}</span>
                <span className="ml-auto font-mono text-xs text-neutral-500">
                  {entry.created_at}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-lg font-bold text-neutral-900">Email delivery failures</h2>
        {failedDeliveries.length === 0 ? (
          <p className="text-[15px] text-neutral-600">No failures recorded.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
            {failedDeliveries.map((failure) => (
              <li key={`${failure.entryId}-${failure.attemptedAt}`} className="px-4 py-3">
                <p className="text-[15px] text-neutral-900">
                  {failure.email} <span className="text-neutral-500">({failure.kind})</span>
                </p>
                <p className="mt-1 text-sm text-[#c8102e]">{failure.error ?? 'unknown error'}</p>
                <p className="mt-1 font-mono text-xs text-neutral-500">{failure.attemptedAt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
