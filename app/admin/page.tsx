import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminShell, StatCard } from '../../components/admin/admin-shell';
import { CampaignControls } from '../../components/admin/campaign-controls';
import { ACTIVE_CAMPAIGN_SLUG, registrationPhase } from '../../lib/campaign/config';
import { formatDateTime } from '../../lib/admin/format';
import { loadDashboard } from '../../lib/admin/queries';
import { requireOperatorSession } from '../../lib/security/operator-session';

export const dynamic = 'force-dynamic';

/**
 * What the operator is told, which is not what a visitor is told.
 * `registrationPhase` collapses paused and closed into one public-facing
 * "closed", but an operator who has just pressed 受付を一時停止 must not then
 * read 受付終了 and believe they ended the event for good. So the status drives
 * this label, and the phase is only consulted for the two cases the status
 * alone cannot distinguish.
 */
function statusLabel(campaign: Parameters<typeof registrationPhase>[0] & { status: string }): string {
  switch (campaign.status) {
    case 'DRAFT':
      return '未開始';
    case 'PAUSED':
      return '一時停止中';
    case 'CLOSED':
      return '受付終了';
  }

  const phase = registrationPhase(campaign);
  if (phase === 'open') return '受付中';
  // Scheduled but not open: either the opening time has not arrived yet, or
  // the cut-off ahead of the draw has already passed.
  return phase === 'before' ? '開始待ち' : '受付終了（抽選時刻）';
}

const ENTRY_STATE_LABEL: Record<string, string> = {
  PENDING: '確認待ち',
  VERIFIED: '確認済み',
};

export default async function AdminDashboard() {
  const operator = await requireOperatorSession();
  const dashboard = await loadDashboard(ACTIVE_CAMPAIGN_SLUG);
  if (!dashboard) notFound();

  const { campaign, verified, pending, recentEntries, failedDeliveries, outboxWaiting } = dashboard;

  return (
    <AdminShell operatorEmail={operator.email} title={campaign.title}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="確認済み応募数" value={verified} />
        <StatCard label="確認待ち" value={pending} />
        <StatCard label="次の発行番号" value={campaign.next_number} />
        <StatCard label="送信待ちメール数" value={outboxWaiting} />
      </div>

      <section className="mt-10 space-y-4">
        <h2 className="text-lg font-bold text-neutral-900">受付状況</h2>
        <dl className="grid gap-2 text-[15px] sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <dt className="text-neutral-600">状態</dt>
            <dd className="flex items-center gap-2 font-semibold text-neutral-900">
              {statusLabel(campaign)}
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-xs font-medium text-neutral-500">
                {campaign.status}
              </span>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-neutral-600">開始日時</dt>
            <dd className="text-neutral-900">{formatDateTime(campaign.opens_at)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-neutral-600">抽選開始日時</dt>
            <dd className="text-neutral-900">{formatDateTime(campaign.draw_starts_at)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-neutral-600">規約バージョン</dt>
            <dd className="font-mono text-neutral-900">{campaign.terms_version}</dd>
          </div>
        </dl>
        <CampaignControls status={campaign.status} drawStartsAt={campaign.draw_starts_at} />
        <p className="text-sm text-neutral-600">
          <Link
            href={`/${campaign.slug}?test=1`}
            target="_blank"
            className="font-medium text-neutral-900 underline underline-offset-2"
          >
            テストモードで開く
          </Link>{' '}
          — 本物のフォームとメールを使いますが、抽選対象にならない番号が発行され、集計やCSVエクスポートからは除外されます。
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-lg font-bold text-neutral-900">最近の応募</h2>
        {recentEntries.length === 0 ? (
          <p className="text-[15px] text-neutral-600">まだ応募はありません。</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
            {recentEntries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                <span className="font-mono text-sm tabular-nums text-neutral-900">
                  {entry.number ?? '—'}
                </span>
                <span className="text-[15px] text-neutral-900">{entry.email}</span>
                <span className="text-sm text-neutral-500">
                  {ENTRY_STATE_LABEL[entry.state] ?? entry.state}
                </span>
                {entry.is_test && (
                  <span className="rounded-full bg-[var(--brand-tint)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-accent)]">
                    テスト
                  </span>
                )}
                <span className="ml-auto text-xs text-neutral-500">
                  {formatDateTime(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-lg font-bold text-neutral-900">メール配信エラー</h2>
        {failedDeliveries.length === 0 ? (
          <p className="text-[15px] text-neutral-600">エラーの記録はありません。</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
            {failedDeliveries.map((failure) => (
              <li key={`${failure.entryId}-${failure.attemptedAt}`} className="px-4 py-3">
                <p className="text-[15px] text-neutral-900">
                  {failure.email} <span className="text-neutral-500">({failure.kind})</span>
                </p>
                <p className="mt-1 text-sm text-[#c8102e]">{failure.error ?? '不明なエラー'}</p>
                <p className="mt-1 text-xs text-neutral-500">{formatDateTime(failure.attemptedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
