import { getRaffleService } from '../../../../../lib/db/server';
import { clientIpAddress, invalidRequest, raffleRequestResponse, readJsonObject } from '../../_shared';

/**
 * Declared rather than left to the platform default of 10-15 seconds: this path
 * calls Cloudflare and the mail provider, and being killed part-way through
 * spends a visitor's send allowance without delivering anything.
 */
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ eventSlug: string }> }) {
  const body = await readJsonObject(request);
  if (!body) return invalidRequest();

  const { eventSlug } = await context.params;
  // The handler only reshapes the request; the service validates every field
  // before it causes any side effect.
  const result = await getRaffleService().requestVerification({
    eventSlug,
    email: body.email,
    locale: body.locale,
    termsConsent: body.terms_consent,
    turnstileToken: body.turnstile_token,
    ipAddress: clientIpAddress(request),
    firstName: body.first_name,
    lastName: body.last_name,
    phone: body.phone,
    gender: body.gender,
    dateOfBirth: body.date_of_birth,
    country: body.country,
    region: body.region,
  });

  return raffleRequestResponse(result);
}
