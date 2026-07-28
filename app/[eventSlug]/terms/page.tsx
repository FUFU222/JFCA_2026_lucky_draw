import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageShell } from '../../../components/public/page-shell';
import { PRIVACY_POLICY_URL, luckyDrawTerms } from '../../../lib/campaign/legal';
import { findCampaign } from '../../../lib/db/public-queries';
import { messages } from '../../../lib/i18n/messages';

export const dynamic = 'force-dynamic';

export default async function TermsPage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  // The terms belong to an event, so an unknown slug has none to show.
  const campaign = await findCampaign(eventSlug);
  if (!campaign) notFound();

  const t = messages;

  return (
    <PageShell>
      <article className="space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-neutral-900">{t.terms.heading}</h1>
          <p className="text-sm text-neutral-600">{campaign.title}</p>
        </header>

        {luckyDrawTerms().map((section) => (
          <section key={section.heading} className="space-y-2">
            <h2 className="text-lg font-bold text-neutral-900">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-[15px] leading-relaxed text-neutral-700">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <p className="text-[15px] leading-relaxed text-neutral-700">
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-neutral-900 underline underline-offset-2"
          >
            LIVAPON Privacy Policy
          </a>
        </p>

        <Link
          href={`/${eventSlug}`}
          className="inline-flex min-h-12 items-center rounded-lg border border-neutral-300 px-5 text-base font-semibold text-neutral-800"
        >
          {t.terms.back}
        </Link>
      </article>
    </PageShell>
  );
}
