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
          label: 'Start entries now',
          dialogTitle: 'Start entries now?',
          dialogBody: 'Visitors will be able to enter immediately.',
          variant: 'primary',
        },
      ];
    case 'SCHEDULED':
      return [
        {
          action: 'PAUSE',
          label: 'Pause registration',
          dialogTitle: 'Pause registration?',
          dialogBody:
            'Visitors will stop being able to enter immediately. Numbers already issued are unaffected.',
          variant: 'secondary',
        },
        {
          action: 'CLOSE',
          label: 'Close entries',
          dialogTitle: 'Close entries?',
          dialogBody:
            'Unlike pausing, this cannot be undone from here. Entry and confirmation are both refused from now on. Numbers already issued are unaffected.',
          variant: 'secondary',
        },
      ];
    case 'PAUSED':
      return [
        {
          action: 'RESUME',
          label: 'Resume registration',
          dialogTitle: 'Resume registration?',
          dialogBody: 'Visitors will be able to enter again immediately.',
          variant: 'primary',
        },
        {
          action: 'CLOSE',
          label: 'Close entries',
          dialogTitle: 'Close entries?',
          dialogBody:
            'Unlike pausing, this cannot be undone from here. Entry and confirmation are both refused from now on. Numbers already issued are unaffected.',
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
      setError('The change could not be applied.');
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  if (status === 'CLOSED') {
    return <p className="text-[15px] text-neutral-600">Entries are closed for this event.</p>;
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
          Set a draw time first — see the event schedule step in the pre-launch checklist. Entries
          cannot be started without one.
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
          cancelLabel="Cancel"
          busy={busy}
          busyLabel="Applying…"
          onCancel={() => setPendingAction(null)}
          onConfirm={() => apply(pendingAction.action)}
        >
          <p>{pendingAction.dialogBody}</p>
        </ConfirmationDialog>
      )}
    </div>
  );
}
