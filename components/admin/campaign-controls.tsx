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
 * someone with database access. Losing an event to a stray tap is the worse
 * risk, so closing is undoable, and the dialog is what makes it deliberate.
 *
 * Reopening is not free, though, and it is worth being exact about why. When
 * closing was made undoable, `draw_starts_at` was the backstop: a number could
 * not be issued once the draw had begun, whatever the status said. The very
 * next change made the schedule optional, and this event runs with no draw
 * time at all — so that backstop is not there, and 受付を再開 after the draw
 * genuinely lets anybody still holding a live link take a number that no
 * exported CSV contains. Hence the wording below, and hence it is not the
 * primary button on the closed screen: the operator arrives there having just
 * finished the event, and the inviting button should not be the one that
 * restarts it.
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
            '押し間違えた直後に戻すための操作です。抽選が終わったあとは押さないでください。確認リンクを持ったまま未確認の人が、また番号を取れる状態に戻ります。その番号は、書き出し済みのCSVには入っていません。',
          variant: 'secondary',
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
