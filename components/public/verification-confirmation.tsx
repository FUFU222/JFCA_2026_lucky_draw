'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmationDialog } from '../ui/confirmation-dialog';
import { messagesFor, type Locale } from '../../lib/i18n/messages';

export interface VerificationConfirmationProps {
  eventSlug: string;
  token: string;
  locale: Locale;
}

/**
 * Opening the emailed link only gets you here. The number is issued by this
 * deliberate action, so a mail client that pre-fetches the URL cannot consume
 * the link or claim a number on the visitor's behalf.
 */
export function VerificationConfirmation({
  eventSlug,
  token,
  locale,
}: VerificationConfirmationProps) {
  const t = messagesFor(locale).verify;
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
        return;
      }

      router.replace(`/${eventSlug}/number/${encodeURIComponent(payload.receipt_token)}`);
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
      setDialogOpen(false);
    }
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
        className="min-h-14 w-full rounded-lg bg-neutral-900 px-6 text-base font-semibold text-white disabled:opacity-40"
      >
        {busy ? t.working : t.action}
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
      >
        <p>{t.dialogBody}</p>
      </ConfirmationDialog>
    </section>
  );
}
