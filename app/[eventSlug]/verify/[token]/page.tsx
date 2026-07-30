import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { PageShell } from '../../../../components/public/page-shell';
import { VerificationConfirmation } from '../../../../components/public/verification-confirmation';
import {
  findCampaign,
  issuedReceiptToken,
  verificationLinkState,
} from '../../../../lib/db/public-queries';
import { requiredSecret } from '../../../../lib/db/server';
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

  if (state === 'usable') {
    return (
      <PageShell>
        <VerificationConfirmation eventSlug={eventSlug} token={token} />
      </PageShell>
    );
  }

  // Nothing is offered once the event is over, because there is nothing to
  // offer. Sending this visitor back to the entry form would only walk them
  // into "Entries are closed" — the same wall, one tap further on.
  if (state === 'event_over') {
    return (
      <PageShell>
        <section className="space-y-5">
          <h1 className="text-2xl font-bold text-neutral-900">
            {messages.schedule.closedHeading}
          </h1>
          <p className="text-[15px] leading-relaxed text-neutral-700">
            {messages.schedule.closedBody}
          </p>
        </section>
      </PageShell>
    );
  }

  // Before calling a used link unusable, check whether it is used *because it
  // worked*. If a number was issued from this link, the person holding it is
  // owed that number, not "enter again to get a new link" — advice that cannot
  // work for them, since a second entry on the same address is answered with
  // silence by design.
  //
  // This is what makes the hand-off after the button press survivable. Issuing
  // the number and showing it are two steps and the second one can be lost — a
  // closed tab, a dropped connection, an in-app browser that will not
  // navigate. Re-opening the link now finishes the job.
  //
  // Below the `event_over` branch on purpose: a receipt can only exist for a
  // consumed token, and `event_over` is only reached for an unconsumed one, so
  // this can never fire for a closed campaign. Ordering it last keeps the read
  // off the path every unconfirmed entrant takes the moment intake closes.
  const receiptToken = await issuedReceiptToken(
    eventSlug,
    token,
    requiredSecret('RECEIPT_TOKEN_SECRET'),
  );
  if (receiptToken) {
    redirect(`/${eventSlug}/number/${encodeURIComponent(receiptToken)}`);
  }

  return (
    <PageShell>
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
    </PageShell>
  );
}
