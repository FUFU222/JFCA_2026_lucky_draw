'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        data-testid="confirmation-dialog-backdrop"
        className="absolute inset-0 bg-neutral-950/50"
        onClick={() => !busy && onCancel()}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-neutral-900">
          {title}
        </h2>

        <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-neutral-700">{children}</div>

        {/* Cancel comes first in the DOM so it reads first and takes focus. */}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-12 flex-1 rounded-lg border border-neutral-300 px-5 text-base font-semibold text-neutral-800 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-h-12 flex-1 rounded-lg bg-neutral-900 px-5 text-base font-semibold text-white disabled:opacity-60"
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
