import { SUPPORT_EMAIL } from '../../lib/campaign/legal';
import { messagesFor, type Locale } from '../../lib/i18n/messages';
import { formatRaffleNumber } from '../../lib/raffle/number';

/**
 * The number is the only thing on this page that matters, so it is the only
 * thing sized to be read across a crowded hall. No profile editing, and no
 * statement about whether the entry has won.
 */
export function NumberReceipt({ number, locale }: { number: bigint; locale: Locale }) {
  const t = messagesFor(locale).receipt;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold text-neutral-900">{t.heading}</h1>

      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-6 py-10 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">{t.label}</p>
        <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight text-neutral-900 sm:text-6xl">
          {formatRaffleNumber(number)}
        </p>
      </div>

      <p className="text-[15px] leading-relaxed text-neutral-800">{t.screenshot}</p>
      <p className="text-[15px] leading-relaxed text-neutral-800">{t.venue}</p>

      <div className="space-y-2 border-t border-neutral-200 pt-6 text-sm text-neutral-600">
        <p>{t.emailed}</p>
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
