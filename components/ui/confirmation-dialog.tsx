'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
  /**
   * Disables the action alone, leaving cancel, Escape and the backdrop live.
   * `busy` would disable those too, which is right while a request is in
   * flight and wrong while the dialog is waiting on something that may never
   * arrive — a captcha that fails has to leave a way out.
   */
  confirmDisabled?: boolean;
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
  confirmDisabled = false,
  children,
  tone = 'neutral',
}: ConfirmationDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Portalled, so it is rendered on the client only. The server has no
  // document to portal into, and matching that on the first client render is
  // what keeps React from throwing the tree away.
  const [mounted, setMounted] = useState(false);
  /* eslint-disable-next-line react-hooks/set-state-in-effect -- adopting
     client-only state on mount is exactly the case this rule asks you to make
     deliberate, and it is the same pattern the entry form uses to restore a
     draft. There is no document to portal into on the server, and rendering
     the portal on the first client pass instead would be the hydration
     mismatch this flag exists to avoid. */
  useEffect(() => setMounted(true), []);

  // `mounted` belongs in here as well as in the render: on the first pass the
  // portal has not been created yet, so the button this wants to focus is not
  // in the document, and focus would silently stay on the page behind.
  //
  // Closing hands focus back to whatever opened it. That mattered less when
  // the markup sat inline next to the trigger and the next Tab resumed nearby;
  // now that the dialog portals to the end of `document.body`, leaving focus
  // where it lands means the next Tab restarts from the top of the page.
  const trigger = useRef<Element | null>(null);
  useEffect(() => {
    if (!mounted) return;
    if (open) {
      trigger.current = document.activeElement;
      cancelRef.current?.focus();
      return;
    }
    const previous = trigger.current;
    trigger.current = null;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  }, [open, mounted]);

  if (!open || !mounted) return null;

  // `iframe` is in the list so a captcha rendered inside the dialog can be
  // reached at all, and hidden inputs are out of it: Turnstile leaves a
  // `cf-turnstile-response` field behind, and a hidden element as `first`
  // meant Tab called `.focus()` on something unfocusable and simply stopped,
  // while shift-Tab never matched and escaped the dialog altogether. This
  // selector was written when no dialog contained an input.
  const focusable = () =>
    Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], iframe, input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])',
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
  // Into `document.body`, never in place.
  //
  // `position: fixed` is only fixed to the viewport while no ancestor has a
  // transform, and the screens this opens from animate in — `fade-in-up`
  // leaves an identity transform on its section, which is enough to make that
  // section the containing block. The backdrop then covered the section
  // instead of the page and the panel was centred inside it: measured at 375
  // wide, the overlay came out 335 by 257 rather than 375 by 812, which left
  // the panel 303 wide with its buttons below the fold. A portal takes the
  // dialog out of reach of any ancestor's transform, overflow or stacking
  // context, so it cannot come back the next time something is animated.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
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
        // Padding is tighter on a phone than it looks like it should be, and
        // the reason is arithmetic rather than taste. A Turnstile widget will
        // not render below 300px. With `p-4` outside and `p-6` here, a 375px
        // screen left 295px inside — and a 360px one, which is the width of
        // most mid-range Android, left 280. `p-2` outside and `p-5` here
        // gives 304px at 360 and 319 at 375, so the challenge fits on the
        // phones people actually bring to a festival. Both go back to normal
        // at `sm`, where there is room to spare.
        className="fade-in-up relative max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6"
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
            disabled={busy || confirmDisabled}
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
    </div>,
    document.body,
  );
}
