import { notFound } from 'next/navigation';

import { PageShell } from '../../components/public/page-shell';
import { RaffleForm } from '../../components/public/raffle-form';
import { registrationPhase } from '../../lib/campaign/config';
import { findCampaign } from '../../lib/db/public-queries';
import { countryOptions } from '../../lib/i18n/countries';
import { messagesFor } from '../../lib/i18n/messages';
import { currentLocale } from '../../lib/i18n/server-locale';
import { getOperatorSession } from '../../lib/security/operator-session';

// The schedule decides what this page says, so it is never served from a cache.
export const dynamic = 'force-dynamic';

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ test?: string }>;
}) {
  const { eventSlug } = await params;
  const [campaign, locale, requestedTest] = await Promise.all([
    findCampaign(eventSlug),
    currentLocale(),
    (async () => (await searchParams).test === '1')(),
  ]);
  if (!campaign) notFound();

  const t = messagesFor(locale);
  const phase = registrationPhase(campaign);

  // `?test=1` only ever does something for a signed-in operator — anyone else
  // requesting it (including a visitor who stumbled on a shared link) gets
  // the ordinary page, silently. The claim is re-verified again, server-side,
  // by `RaffleService` before any entry is actually marked as test.
  const isTestMode = requestedTest && (await getOperatorSession()) !== null;

  return (
    <PageShell locale={locale}>
      <h1 className="sr-only">{campaign.title}</h1>

      {phase === 'open' || isTestMode ? (
        <RaffleForm
          eventSlug={eventSlug}
          locale={locale}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
          countries={countryOptions(locale)}
          isTestMode={isTestMode}
        />
      ) : (
        <section className="space-y-3">
          <h2 className="text-2xl font-bold text-neutral-900">
            {phase === 'before' ? t.schedule.beforeHeading : t.schedule.closedHeading}
          </h2>
          <p className="text-[15px] leading-relaxed text-neutral-700">
            {phase === 'before' ? t.schedule.beforeBody : t.schedule.closedBody}
          </p>
        </section>
      )}
    </PageShell>
  );
}
