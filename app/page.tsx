import { redirect } from 'next/navigation';

import { ACTIVE_CAMPAIGN_SLUG } from '../lib/campaign/config';

/**
 * The QR codes always carry the event URL. The bare domain is a courtesy
 * entrance that forwards to whichever event is currently running.
 */
export default function Home() {
  redirect(`/${ACTIVE_CAMPAIGN_SLUG}`);
}
