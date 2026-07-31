'use client';

import { useEffect, useRef, useState } from 'react';

import { messages } from '../../lib/i18n/messages';
import { formatRaffleNumber } from '../../lib/raffle/number';
import { drawTicket, ticketFileName } from '../../lib/raffle/ticket-canvas';

/**
 * The ticket, and the one control that lets a visitor keep it.
 *
 * The number is server-rendered markup and stays that way. It is never fetched,
 * never drawn by script, and never waits on a second request — on a venue
 * network at capacity, an image the browser has to go and get is a number that
 * might not arrive, on the one page the whole visit exists to reach.
 *
 * What script adds is a picture of the same thing, drawn locally from values
 * already on the page. When it works the ticket becomes a real image, so
 * long-pressing it offers Photos and the button downloads the file. When it
 * does not — no canvas, no script, an old browser — the markup underneath is
 * untouched and a screenshot still works, which is what the line under the
 * button tells everybody to do anyway.
 */
export function SaveableTicket({ number, eventTitle }: { number: bigint; eventTitle: string }) {
  const t = messages.receipt;
  const ticketRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const element = ticketRef.current;
    if (!element) return;
    let url: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        // Without this the draw can use a fallback face: `next/font` loads
        // asynchronously and canvas takes whatever is ready at that instant.
        await document.fonts?.ready;
        if (cancelled) return;

        const canvas = document.createElement('canvas');
        drawTicket(canvas, {
          number,
          eventTitle,
          fontFamily: getComputedStyle(element).fontFamily,
        });

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        );
        if (cancelled || !blob) return;

        // A blob URL rather than a data URL: iOS Safari is markedly better at
        // downloading the former, and this is the platform the button exists
        // for.
        url = URL.createObjectURL(blob);

        // Decoded ahead of the swap where possible, not left for the browser
        // to do on first paint. The `ticket-pop` animation's clock starts the
        // moment the `<img>` is inserted, not when it is first composited —
        // an image that still needs decoding at insertion can take long
        // enough that the animation's 500ms is over before the browser ever
        // paints a frame of it, so the pop does not play at all: the ticket
        // snaps straight to its settled state. Measured on a real phone, this
        // was not the rare case.
        //
        // Raced against a short timeout rather than awaited outright:
        // `decode()` is not guaranteed to settle at all in every environment
        // (observed hanging indefinitely, neither resolving nor rejecting, in
        // one browser automation harness during testing). This is the one
        // screen the whole visit exists to reach, so a smoother pop is worth
        // having but never worth risking the number itself on — 200ms is
        // long enough for a same-origin blob decode to finish in practice,
        // short enough that a visitor who hits the fallback never notices
        // they did.
        const preload = new Image();
        preload.src = url;
        await Promise.race([
          preload.decode().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 200)),
        ]);
        // Releases `preload` once the race is settled either way, so a decode
        // that never resolves does not pin this throwaway Image for the rest
        // of the page's life — the failure mode the race exists to survive,
        // not merely to hide.
        preload.src = '';
        if (cancelled) return;

        setSaved(url);
      } catch {
        // The markup below is the number. Losing the picture costs the button
        // and nothing else.
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [number, eventTitle]);

  return (
    // The ticket and its one control belong together, spaced apart from each
    // other and from the copy below. The confetti stays a sibling of this
    // wrapper, so it still bursts from the top edge of the ticket.
    <div className="space-y-3">
      {saved ? (
        // The same box at the same aspect, so the swap cannot move anything.
        //
        // `next/image` is not an option and not a missed optimisation: this
        // source is a blob the browser just made, so there is nothing to fetch,
        // nothing to optimise, and no loader that could reach it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={saved}
          alt={`${t.label}: ${formatRaffleNumber(number)}`}
          className="ticket-pop block aspect-[2/1] w-full rounded-2xl"
        />
      ) : (
        <div
          ref={ticketRef}
          className="ticket-pop flex aspect-[2/1] w-full flex-col items-center justify-center rounded-2xl border-2 border-[var(--brand-accent)] bg-[var(--brand-tint)] px-4 text-center"
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-500">
            {t.label}
          </p>
          <p className="mt-2 text-5xl font-bold tabular-nums tracking-tight text-neutral-900 sm:text-6xl">
            {formatRaffleNumber(number)}
          </p>
          <p className="mt-3 text-xs text-neutral-500">{eventTitle}</p>
          <p className="mt-1 text-[11px] font-semibold tracking-[0.15em] text-[var(--brand-accent)]">
            LIVAPON
          </p>
        </div>
      )}

      {saved ? (
        <a
          href={saved}
          download={ticketFileName(number)}
          className="flex min-h-12 w-full items-center justify-center rounded-lg bg-[var(--brand-accent)] px-5 text-base font-semibold text-white"
        >
          {t.save}
        </a>
      ) : null}
    </div>
  );
}
