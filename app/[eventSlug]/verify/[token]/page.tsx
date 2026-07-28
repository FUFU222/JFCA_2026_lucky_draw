import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageShell } from '../../../../components/public/page-shell';
import { VerificationConfirmation } from '../../../../components/public/verification-confirmation';
import { findCampaign, verificationLinkState } from '../../../../lib/db/public-queries';
import { messages } from '../../../../lib/i18n/messages';

// This page must never be cached: it reports whether a link is still usable.
export const dynamic = 'force-dynamic';

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ eventSlug: string; token: string }>;
}) {
  const { eventSlug, token } = await params;
  const campaign = await findCampaign(eventSlug);
  if (!campaign) notFound();

  const t = messages.verify;
  // A GET only reads. The number is issued by the action on this page.
  const state = await verificationLinkState(eventSlug, token);

  return (
    <PageShell>
      {state === 'usable' ? (
        <VerificationConfirmation eventSlug={eventSlug} token={token} />
      ) : (
        <section className="space-y-5">
          <h1 className="text-2xl font-bold text-neutral-900">{t.invalidHeading}</h1>
          <p className="text-[15px] leading-relaxed text-neutral-700">{t.invalidBody}</p>
          <Link
            href={`/${eventSlug}`}
            className="inline-flex min-h-12 items-center rounded-lg bg-neutral-900 px-5 text-base font-semibold text-white"
          >
            {t.invalidAction}
          </Link>
        </section>
      )}
    </PageShell>
  );
}
