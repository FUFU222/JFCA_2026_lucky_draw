import { notFound } from 'next/navigation';

import { PageShell } from '../../components/public/page-shell';
import { RaffleForm } from '../../components/public/raffle-form';
import { registrationPhase } from '../../lib/campaign/config';
import { findCampaign } from '../../lib/db/public-queries';
import { countryOptions } from '../../lib/i18n/countries';
import { messages } from '../../lib/i18n/messages';
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
  const [campaign, requestedTest] = await Promise.all([
    findCampaign(eventSlug),
    (async () => (await searchParams).test === '1')(),
  ]);
  if (!campaign) notFound();

  const phase = registrationPhase(campaign);

  // `?test=1` only ever does something for a signed-in operator — anyone else
  // requesting it (including a visitor who stumbled on a shared link) gets
  // the ordinary page, silently. The claim is re-verified again, server-side,
  // by `RaffleService` before any entry is actually marked as test.
  const isTestMode = requestedTest && (await getOperatorSession()) !== null;

  return (
    <PageShell>
      <h1 className="sr-only">{campaign.title}</h1>

      {phase === 'open' || isTestMode ? (
        <RaffleForm
          eventSlug={eventSlug}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
          countries={countryOptions()}
          isTestMode={isTestMode}
        />
      ) : (
        <section className="space-y-3">
          <h2 className="text-2xl font-bold text-neutral-900">
            {phase === 'before' ? messages.schedule.beforeHeading : messages.schedule.closedHeading}
          </h2>
          <p className="text-[15px] leading-relaxed text-neutral-700">
            {phase === 'before' ? messages.schedule.beforeBody : messages.schedule.closedBody}
          </p>
        </section>
      )}
    </PageShell>
  );
}
