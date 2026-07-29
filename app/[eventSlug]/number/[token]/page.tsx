import { notFound } from 'next/navigation';

import { NumberReceipt } from '../../../../components/public/number-receipt';
import { PageShell } from '../../../../components/public/page-shell';
import { findCampaign, findReceipt } from '../../../../lib/db/public-queries';

// The receipt is looked up per request and never cached at the edge: the token
// is a bearer credential and its page is personal.
export const dynamic = 'force-dynamic';

export default async function NumberPage({
  params,
}: {
  params: Promise<{ eventSlug: string; token: string }>;
}) {
  const { eventSlug, token } = await params;
  const campaign = await findCampaign(eventSlug);
  if (!campaign) notFound();

  const receipt = await findReceipt(eventSlug, token);
  // A missing receipt is a real 404: a soft one invites indexing of a page
  // whose URL is a bearer token.
  if (!receipt) notFound();

  return (
    <PageShell>
      <NumberReceipt number={receipt.number} />
    </PageShell>
  );
}
