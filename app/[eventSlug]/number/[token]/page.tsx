import { notFound } from 'next/navigation';

import { NumberReceipt } from '../../../../components/public/number-receipt';
import { PageShell } from '../../../../components/public/page-shell';
import { SUPPORT_EMAIL } from '../../../../lib/campaign/legal';
import { findCampaign, findReceipt } from '../../../../lib/db/public-queries';
import { messagesFor } from '../../../../lib/i18n/messages';
import { currentLocale } from '../../../../lib/i18n/server-locale';

// The receipt is looked up per request and never cached at the edge: the token
// is a bearer credential and its page is personal.
export const dynamic = 'force-dynamic';

export default async function NumberPage({
  params,
}: {
  params: Promise<{ eventSlug: string; token: string }>;
}) {
  const { eventSlug, token } = await params;
  const [campaign, locale] = await Promise.all([findCampaign(eventSlug), currentLocale()]);
  if (!campaign) notFound();

  const receipt = await findReceipt(eventSlug, decodeURIComponent(token));
  const t = messagesFor(locale).receipt;

  return (
    <PageShell locale={locale}>
      {receipt ? (
        <NumberReceipt number={receipt.number} locale={locale} />
      ) : (
        <section className="space-y-4">
          <h1 className="text-2xl font-bold text-neutral-900">{t.notFoundHeading}</h1>
          <p className="text-[15px] leading-relaxed text-neutral-700">
            {t.notFoundBody}{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-neutral-900 underline underline-offset-2"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>
      )}
    </PageShell>
  );
}
