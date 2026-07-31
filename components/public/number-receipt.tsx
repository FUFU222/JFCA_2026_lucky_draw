import type { CSSProperties } from 'react';

import { SUPPORT_EMAIL } from '../../lib/campaign/legal';
import { messages } from '../../lib/i18n/messages';
import { SaveableTicket } from './saveable-ticket';

/**
 * Six pieces, not a screenful — enough to say "this was issued" without
 * turning the ticket into decoration. Purely CSS: no JS, no bundle cost, and
 * `prefers-reduced-motion` collapses every one of them to a static dot via
 * the sitewide rule in globals.css.
 */
const CONFETTI: Array<{ left: string; color: string; tx: string; ty: string; rot: string; delay: string }> = [
  { left: '12%', color: 'var(--brand-accent)', tx: '-18px', ty: '-26px', rot: '-35deg', delay: '0ms' },
  { left: '28%', color: 'var(--brand-gold)', tx: '-8px', ty: '-34px', rot: '20deg', delay: '60ms' },
  { left: '50%', color: 'var(--foreground)', tx: '2px', ty: '-38px', rot: '-10deg', delay: '30ms' },
  { left: '68%', color: 'var(--brand-gold)', tx: '14px', ty: '-30px', rot: '40deg', delay: '90ms' },
  { left: '84%', color: 'var(--brand-accent)', tx: '22px', ty: '-24px', rot: '-20deg', delay: '45ms' },
  { left: '92%', color: 'var(--foreground)', tx: '30px', ty: '-16px', rot: '15deg', delay: '75ms' },
];

/**
 * The number is the only thing on this page that matters, so it is the only
 * thing sized to be read across a crowded hall. No profile editing, and no
 * statement about whether the entry has won.
 *
 * Keeping it is the second job, and the visitor gets three ways to do it — the
 * button, a long press on the ticket, a screenshot — described in one line
 * rather than three, because this screen earns its calm.
 */
export function NumberReceipt({ number, eventTitle }: { number: bigint; eventTitle: string }) {
  const t = messages.receipt;

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-bold text-neutral-900">{t.heading}</h1>

      <div className="relative">
        {CONFETTI.map((piece, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="confetti-piece"
            style={
              {
                left: piece.left,
                top: 0,
                backgroundColor: piece.color,
                animationDelay: piece.delay,
                '--tx': piece.tx,
                '--ty': piece.ty,
                '--rot': piece.rot,
              } as CSSProperties
            }
          />
        ))}

        <SaveableTicket number={number} eventTitle={eventTitle} />
      </div>

      <p className="text-[15px] leading-relaxed text-neutral-800">{t.saveHint}</p>
      <p className="text-[15px] leading-relaxed text-neutral-800">{t.venue}</p>

      <div className="space-y-2 border-t border-neutral-200 pt-6 text-sm text-neutral-600">
        <p>{t.lost}</p>
        <p>
          {t.support}{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-neutral-900 underline underline-offset-2"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}
