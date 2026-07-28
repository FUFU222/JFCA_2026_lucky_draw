'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmationDialog } from '../ui/confirmation-dialog';

export function CampaignControls({ status }: { status: string }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paused = status === 'PAUSED';
  const action = paused ? 'RESUME' : 'PAUSE';

  async function apply() {
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
      setDialogOpen(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="min-h-12 rounded-lg border border-neutral-300 px-5 text-base font-semibold text-neutral-900"
      >
        {paused ? 'Resume registration' : 'Pause registration'}
      </button>

      {error && (
        <p role="alert" className="text-sm font-medium text-[#c8102e]">
          {error}
        </p>
      )}

      <ConfirmationDialog
        open={dialogOpen}
        title={paused ? 'Resume registration?' : 'Pause registration?'}
        confirmLabel={paused ? 'Resume registration' : 'Pause registration'}
        cancelLabel="Cancel"
        busy={busy}
        busyLabel="Applying…"
        onCancel={() => setDialogOpen(false)}
        onConfirm={apply}
      >
        <p>
          {paused
            ? 'Visitors will be able to enter again immediately.'
            : 'Visitors will stop being able to enter immediately. Numbers already issued are unaffected.'}
        </p>
      </ConfirmationDialog>
    </div>
  );
}
