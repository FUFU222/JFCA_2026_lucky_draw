import { getRaffleService } from '../../../../../lib/db/server';
import { clientIpAddress, invalidRequest, raffleRequestResponse, readJsonObject } from '../../_shared';

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
