import { notFound } from 'next/navigation';

import { AdminShell } from '../../../components/admin/admin-shell';
import { ExportButton } from '../../../components/admin/export-button';
import { ACTIVE_CAMPAIGN_SLUG } from '../../../lib/campaign/config';
import { formatDateTime } from '../../../lib/admin/format';
import { loadDashboard, searchEntries } from '../../../lib/admin/queries';
import { requireOperatorSession } from '../../../lib/security/operator-session';

export const dynamic = 'force-dynamic';

const ENTRY_STATE_LABEL: Record<string, string> = {
  PENDING: '確認待ち',
  VERIFIED: '確認済み',
};

export default async function AdminEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const operator = await requireOperatorSession();
  const dashboard = await loadDashboard(ACTIVE_CAMPAIGN_SLUG);
  if (!dashboard) notFound();

  const { q } = await searchParams;
  const entries = await searchEntries({ campaignId: dashboard.campaign.id, query: q });

  return (
    <AdminShell operatorEmail={operator.email} title="応募一覧">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <label htmlFor="q" className="block text-sm font-medium text-neutral-800">
            メールアドレスまたは発行番号で検索
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 text-base"
          />
        </div>
        <button
          type="submit"
          className="min-h-12 rounded-lg bg-neutral-900 px-5 text-base font-semibold text-white"
        >
          検索
        </button>
        <ExportButton
          eventSlug={ACTIVE_CAMPAIGN_SLUG}
          entryCount={dashboard.verified + dashboard.pending}
        />
      </form>

      <p className="mt-6 text-sm text-neutral-600">
        {entries.length === 100
          ? '最初の100件を表示しています。絞り込むとさらに表示できます。'
          : `${entries.length}件`}
      </p>

      <table className="mt-3 w-full border-collapse text-left text-[15px]">
        <thead>
          <tr className="border-b border-neutral-300 text-sm text-neutral-600">
            <th scope="col" className="py-2 pr-4 font-medium">
              番号
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              メールアドレス
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              状態
            </th>
            <th scope="col" className="py-2 font-medium">
              応募日時
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-neutral-200">
              <td className="py-2 pr-4 font-mono tabular-nums">{entry.number ?? '—'}</td>
              <td className="py-2 pr-4">
                {entry.email}
                {entry.is_test && (
                  <span className="ml-2 rounded-full bg-[var(--brand-tint)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-accent)]">
                    テスト
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 text-neutral-600">
                {ENTRY_STATE_LABEL[entry.state] ?? entry.state}
              </td>
              <td className="py-2 text-xs text-neutral-500">{formatDateTime(entry.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {entries.length === 0 && (
        <p className="mt-4 text-[15px] text-neutral-600">該当する応募が見つかりませんでした。</p>
      )}
    </AdminShell>
  );
}
