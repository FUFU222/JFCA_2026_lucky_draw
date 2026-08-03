import { notFound } from 'next/navigation';

import { NumberLookupForm } from '../../../components/public/number-lookup-form';
import { PageShell } from '../../../components/public/page-shell';
import { findCampaign } from '../../../lib/db/public-queries';
import { getOperatorSession } from '../../../lib/security/operator-session';

// Deliberately not gated on the schedule at all — see the comment on
// `RaffleService.lookupNumber`. A visitor needs this most around the draw
// itself, after intake has closed and before results are announced.
export const dynamic = 'force-dynamic';

export default async function LookupPage({
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

  // Same pattern as the entry page: the claim is re-verified server-side
  // before `NumberLookupForm` is ever told test mode is on.
  const isTestMode = requestedTest && (await getOperatorSession()) !== null;

  return (
    <PageShell>
      <NumberLookupForm
        eventSlug={eventSlug}
        eventTitle={campaign.title}
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
        isTestMode={isTestMode}
      />
    </PageShell>
  );
}
