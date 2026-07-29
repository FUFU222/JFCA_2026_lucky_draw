'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
 * from `DRAFT`, and `CLOSED` offers only the way back.
 *
 * 受付を終了 sits next to 受付を一時停止, and it used to be terminal on this
 * screen — a mis-tap at a busy booth ended the event with no recovery short of
 * someone with database access. The one-way rule was also buying less than it
 * looked: `draw_starts_at` already refuses to issue a number once the draw has
 * begun, so reopening afterwards cannot put anybody into the draw. Losing an
 * event to a stray tap is the worse risk, so closing is now undoable, and the
 * dialog is what makes it deliberate.
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
            'イベントの終了に使います。以後、応募も確認も受け付けなくなります。すでに発行された番号への影響はありません。誤って押した場合は再開できますが、操作は記録されます。',
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
            'イベントの終了に使います。以後、応募も確認も受け付けなくなります。すでに発行された番号への影響はありません。誤って押した場合は再開できますが、操作は記録されます。',
          variant: 'secondary',
        },
      ];
    case 'CLOSED':
      return [
        {
          action: 'RESUME',
          label: '受付を再開',
          dialogTitle: '終了した受付を再開しますか？',
          dialogBody:
            '開始日時と抽選日時はそのままで、受付だけを再び開きます。抽選開始の30分前を過ぎている場合は、再開しても受付は開かないままです。',
          variant: 'primary',
        },
      ];
    default:
      return [];
  }
}

export function CampaignControls({ status }: { status: string }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<ActionSpec | null>(null);
  const [sending, setSending] = useState(false);
  // `router.refresh()` re-fetches the dashboard's server components and does
  // not resolve, so without a transition to watch there is nothing to wait on:
  // the controls would go live again the instant the POST returned, over
  // figures and a state line that still describe the campaign as it was. The
  // transition stays pending until the refreshed dashboard has rendered.
  const [refreshing, startRefresh] = useTransition();
  const busy = sending || refreshing;
  const [error, setError] = useState<string | null>(null);

  const actions = actionsFor(status);

  async function apply(action: Action) {
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/admin/campaign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error('failed');
      startRefresh(() => router.refresh());
    } catch {
      setError('変更を適用できませんでした。');
    } finally {
      // Only the request is finished here; `refreshing` keeps the controls
      // disabled until the dashboard actually shows the new state.
      setSending(false);
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-3">
      {status === 'CLOSED' && (
        <p className="text-[15px] text-neutral-600">
          受付は終了しています。誤って押した場合は再開できます。
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {actions.map((spec) => (
          <button
            key={spec.action}
            type="button"
            // Also closed while a change is being applied: until the refreshed
            // dashboard arrives these buttons describe the campaign as it was,
            // and a second press would act on figures that are already stale.
            disabled={busy}
            onClick={() => setPendingAction(spec)}
            className={
              spec.variant === 'primary'
                ? 'min-h-12 rounded-lg bg-[var(--brand-accent)] px-5 text-base font-semibold text-white disabled:bg-neutral-300 disabled:text-neutral-500'
                : 'min-h-12 rounded-lg border border-neutral-300 px-5 text-base font-semibold text-neutral-900 disabled:border-neutral-200 disabled:text-neutral-400'
            }
          >
            {spec.label}
          </button>
        ))}
      </div>


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
