import { notFound } from 'next/navigation';

import { NumberReceipt } from '../../../../components/public/number-receipt';
import { PageShell } from '../../../../components/public/page-shell';
import { findCampaign, findReceipt } from '../../../../lib/db/public-queries';
import { bearerTokenRobotsMetadata } from '../../../../lib/security/bearer-token-page';

// The receipt is looked up per request and never cached at the edge: the token
// is a bearer credential and its page is personal.
export const dynamic = 'force-dynamic';

// The URL *is* the credential, so this page must never end up in an index. It
// is unlinked and a missing receipt is a hard 404, which is most of the reason
// it would not be found anyway — this is the part that does not depend on how a
// particular crawler discovers URLs.
export const metadata = bearerTokenRobotsMetadata;

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
      <NumberReceipt number={receipt.number} eventTitle={campaign.title} />
    </PageShell>
  );
}
