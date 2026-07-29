'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { Spinner } from './spinner';

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  busyLabel?: string;
  children?: ReactNode;
  /**
   * `brand` is for the public entry flow, where the confirm button is the
   * one moment this dialog shares the site's accent color. Admin actions
   * (pause, close, export) stay `neutral`, their existing look.
   */
  tone?: 'neutral' | 'brand';
}

/**
 * Used only in front of actions a visitor cannot take back. Cancel holds the
 * initial focus, Escape and the backdrop both cancel, and the action button
 * names what it will do instead of saying OK — so nobody confirms an
 * irreversible step by pressing Enter out of habit.
 */
export function ConfirmationDialog({
  open,
  title,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  busyLabel,
  children,
  tone = 'neutral',
}: ConfirmationDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const focusable = () =>
    Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const controls = focusable();
    if (controls.length === 0) return;

    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;

    // Focus stays inside: forward from the last control wraps to the first and
    // backward from the first wraps to the last.
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  // Centred at every width. This used to sit against the bottom edge on a
  // phone, in the bottom-sheet style, which put the question down in the
  // corner of the screen and left the decision reading as an afterthought
  // rather than as the thing being asked. The padding keeps the panel off the
  // screen edges, and it scrolls rather than overflowing when a short screen —
  // a phone held sideways — cannot fit it.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        data-testid="confirmation-dialog-backdrop"
        className="fade-in absolute inset-0 bg-neutral-950/50"
        onClick={() => !busy && onCancel()}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="fade-in-up relative max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-neutral-900">
          {title}
        </h2>

        <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-neutral-700">{children}</div>

        {/*
          Cancel comes first in the DOM so it reads first and takes focus.
          Both carry real vertical padding rather than relying on `min-h-12`
          alone: two lines of 16px text come to exactly 48px, so a label that
          wraps would otherwise fill the button edge to edge with no room
          around it.
        */}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-12 flex-1 rounded-lg border border-neutral-300 px-5 py-3 text-base font-semibold leading-snug text-neutral-800 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`min-h-12 flex-1 rounded-lg px-5 py-3 text-base font-semibold leading-snug text-white disabled:opacity-60 ${
              tone === 'brand'
                ? 'bg-[var(--brand-accent)] hover:bg-[var(--brand-accent-hover)]'
                : 'bg-neutral-900'
            }`}
          >
            <span className="inline-flex items-center justify-center gap-2">
              {busy && <Spinner />}
              {busy && busyLabel ? busyLabel : confirmLabel}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
