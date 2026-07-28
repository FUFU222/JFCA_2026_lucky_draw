import { notFound } from 'next/navigation';

import { PageShell } from '../../components/public/page-shell';
import { RaffleForm } from '../../components/public/raffle-form';
import { registrationPhase } from '../../lib/campaign/config';
import { findCampaign } from '../../lib/db/public-queries';
import { countryOptions } from '../../lib/i18n/countries';
import { messagesFor } from '../../lib/i18n/messages';
import { currentLocale } from '../../lib/i18n/server-locale';

// The schedule decides what this page says, so it is never served from a cache.
export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const [campaign, locale] = await Promise.all([findCampaign(eventSlug), currentLocale()]);
  if (!campaign) notFound();

  const t = messagesFor(locale);
  const phase = registrationPhase(campaign);

  return (
    <PageShell locale={locale}>
      <h1 className="sr-only">{campaign.title}</h1>

      {phase === 'open' ? (
        <RaffleForm
          eventSlug={eventSlug}
          locale={locale}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
          countries={countryOptions(locale)}
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
