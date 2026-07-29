'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmationDialog } from '../ui/confirmation-dialog';
import { Spinner } from '../ui/spinner';
import { messages } from '../../lib/i18n/messages';

export interface VerificationConfirmationProps {
  eventSlug: string;
  token: string;
}

/**
 * Opening the emailed link only gets you here. The number is issued by this
 * deliberate action, so a mail client that pre-fetches the URL cannot consume
 * the link or claim a number on the visitor's behalf.
 */
export function VerificationConfirmation({ eventSlug, token }: VerificationConfirmationProps) {
  const t = messages.verify;
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${eventSlug}/verify/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json()) as { ok?: boolean; receipt_token?: string };

      if (!response.ok || !payload.ok || !payload.receipt_token) {
        setError(response.status === 400 ? t.invalidBody : t.failed);
        stopWorking();
        return;
      }

      // Deliberately stays busy, and deliberately has no `finally`.
      // `router.replace` only *starts* the navigation; the number page is
      // dynamic and has its own database reads, so it is around a second
      // before it paints. Releasing the busy state here put this screen back
      // — with a live, tappable button — for that whole second, which reads as
      // "nothing happened" and invites a second tap. The dialog stays up,
      // still saying it is issuing the number, until the new page replaces it.
      router.replace(`/${eventSlug}/number/${encodeURIComponent(payload.receipt_token)}`);
    } catch {
      setError(t.failed);
      stopWorking();
    }
  }

  function stopWorking() {
    setBusy(false);
    setDialogOpen(false);
  }

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-bold text-neutral-900">{t.heading}</h1>
      <p className="text-[15px] leading-relaxed text-neutral-700">{t.body}</p>

      {error && (
        <p role="alert" className="text-sm font-medium text-[#c8102e]">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => setDialogOpen(true)}
        className="min-h-14 w-full rounded-lg bg-[var(--brand-accent)] px-6 text-base font-semibold text-white transition-colors hover:bg-[var(--brand-accent-hover)] active:bg-[var(--brand-accent-hover)] disabled:bg-neutral-400"
      >
        <span className="inline-flex items-center justify-center gap-2">
          {busy && <Spinner />}
          {busy ? t.working : t.action}
        </span>
      </button>

      <ConfirmationDialog
        open={dialogOpen}
        title={t.dialogTitle}
        confirmLabel={t.dialogConfirm}
        cancelLabel={t.dialogCancel}
        busy={busy}
        busyLabel={t.working}
        onCancel={() => setDialogOpen(false)}
        onConfirm={confirm}
        tone="brand"
      >
        <p>{t.dialogBody}</p>
      </ConfirmationDialog>
    </section>
  );
}
