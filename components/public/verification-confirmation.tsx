'use client';

import { useState } from 'react';

import { Spinner } from '../ui/spinner';
import { messages } from '../../lib/i18n/messages';

export interface VerificationConfirmationProps {
  eventSlug: string;
  token: string;
}

/**
 * Opening the emailed link only gets you here. The number is issued by the
 * button below, never by the GET, so a mail client that pre-fetches the URL
 * cannot consume the link or claim a number on the visitor's behalf.
 *
 * There is deliberately no confirmation dialog in front of that button. One
 * used to sit here, but it only restated what this page already says, on a
 * page that exists to do one thing, reached by opening a link on purpose. The
 * dialog on the entry form earns its place because it shows the typed address
 * back — a typo there is a real and common mistake with no other guard. Here
 * there is nothing to check and nothing to lose: the "irreversible" outcome
 * being confirmed is precisely the one the visitor came for.
 */
export function VerificationConfirmation({ eventSlug, token }: VerificationConfirmationProps) {
  const t = messages.verify;
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

      // A full document navigation, not `router.replace`.
      //
      // The number is issued by the time this line runs, so the hand-off to
      // the receipt page is the last thing that can still fail — and on
      // production it did: a confirm returned 200, the number was issued and
      // the receipt emailed, and no request for the receipt page was ever
      // made. The client-side navigation produced nothing at all. These links
      // are opened from a mail app, so the page is very often inside an
      // in-app browser, which is exactly where the App Router's history
      // handling is least dependable.
      //
      // `assign` cannot silently do nothing. It costs a document load the
      // soft navigation saved, which is the right trade for the one screen
      // the whole visit exists to reach. A used link now also redirects to
      // this same page server-side, so even a failure here is recoverable.
      //
      // Deliberately stays busy, and deliberately has no `finally`: the
      // navigation is asynchronous, and releasing the button first put this
      // screen back with a live, tappable button, which reads as "nothing
      // happened" and invites a second tap.
      window.location.assign(`/${eventSlug}/number/${encodeURIComponent(payload.receipt_token)}`);
    } catch {
      setError(t.failed);
      stopWorking();
    }
  }

  function stopWorking() {
    setBusy(false);
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
        onClick={confirm}
        className="min-h-14 w-full rounded-lg bg-[var(--brand-accent)] px-6 py-3 text-base font-semibold leading-snug text-white transition-colors hover:bg-[var(--brand-accent-hover)] active:bg-[var(--brand-accent-hover)] disabled:bg-neutral-400"
      >
        <span className="inline-flex items-center justify-center gap-2">
          {busy && <Spinner />}
          {busy ? t.working : t.action}
        </span>
      </button>
    </section>
  );
}
