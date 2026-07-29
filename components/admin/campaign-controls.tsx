'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmationDialog } from '../ui/confirmation-dialog';

type Action = 'PAUSE' | 'RESUME' | 'START' | 'CLOSE';

interface ActionSpec {
  action: Action;
  label: string;
  dialogTitle: string;
  dialogBody: string;
  variant: 'primary' | 'secondary';
}

/**
 * What can be done depends only on the current status: nothing is "pause"
 * from `DRAFT`, and nothing is offered at all once `CLOSED` — that state is
 * terminal by design (`docs/operations/on-site-runbook.md`).
 */
function actionsFor(status: string): ActionSpec[] {
  switch (status) {
    case 'DRAFT':
      return [
        {
          action: 'START',
          label: '今すぐ受付を開始',
          dialogTitle: '今すぐ受付を開始しますか？',
          dialogBody: '来場者はすぐに応募できるようになります。',
          variant: 'primary',
        },
      ];
    case 'SCHEDULED':
      return [
        {
          action: 'PAUSE',
          label: '受付を一時停止',
          dialogTitle: '受付を一時停止しますか？',
          dialogBody:
            '来場者はすぐに応募できなくなります。すでに発行された番号への影響はありません。',
          variant: 'secondary',
        },
        {
          action: 'CLOSE',
          label: '受付を終了',
          dialogTitle: '受付を終了しますか？',
          dialogBody:
            '一時停止と異なり、この画面から元に戻すことはできません。以後、応募・確認ともに受け付けなくなります。すでに発行された番号への影響はありません。',
          variant: 'secondary',
        },
      ];
    case 'PAUSED':
      return [
        {
          action: 'RESUME',
          label: '受付を再開',
          dialogTitle: '受付を再開しますか？',
          dialogBody: '来場者はすぐにまた応募できるようになります。',
          variant: 'primary',
        },
        {
          action: 'CLOSE',
          label: '受付を終了',
          dialogTitle: '受付を終了しますか？',
          dialogBody:
            '一時停止と異なり、この画面から元に戻すことはできません。以後、応募・確認ともに受け付けなくなります。すでに発行された番号への影響はありません。',
          variant: 'secondary',
        },
      ];
    default:
      return [];
  }
}

export function CampaignControls({
  status,
  drawStartsAt,
}: {
  status: string;
  drawStartsAt: string | null;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<ActionSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = actionsFor(status);
  const startBlocked = status === 'DRAFT' && drawStartsAt === null;

  async function apply(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/admin/campaign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setError('変更を適用できませんでした。');
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  if (status === 'CLOSED') {
    return <p className="text-[15px] text-neutral-600">このイベントの受付は終了しました。</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {actions.map((spec) => (
          <button
            key={spec.action}
            type="button"
            disabled={spec.action === 'START' && startBlocked}
            onClick={() => setPendingAction(spec)}
            className={
              spec.variant === 'primary'
                ? 'min-h-12 rounded-lg bg-[var(--brand-accent)] px-5 text-base font-semibold text-white disabled:bg-neutral-300 disabled:text-neutral-500'
                : 'min-h-12 rounded-lg border border-neutral-300 px-5 text-base font-semibold text-neutral-900'
            }
          >
            {spec.label}
          </button>
        ))}
      </div>

      {startBlocked && (
        <p className="text-sm text-neutral-600">
          先に抽選日時を設定してください（事前準備チェックリストのイベントスケジュールの手順を参照）。設定しないと受付を開始できません。
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-[#c8102e]">
          {error}
        </p>
      )}

      {pendingAction && (
        <ConfirmationDialog
          open
          title={pendingAction.dialogTitle}
          confirmLabel={pendingAction.label}
          cancelLabel="キャンセル"
          busy={busy}
          busyLabel="適用中…"
          onCancel={() => setPendingAction(null)}
          onConfirm={() => apply(pendingAction.action)}
        >
          <p>{pendingAction.dialogBody}</p>
        </ConfirmationDialog>
      )}
    </div>
  );
}
