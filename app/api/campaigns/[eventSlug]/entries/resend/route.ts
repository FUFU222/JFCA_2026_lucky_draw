import { getRaffleService } from '../../../../../../lib/db/server';
import {
  clientIpAddress,
  invalidRequest,
  raffleRequestResponse,
  readJsonObject,
} from '../../../_shared';

export async function POST(request: Request, context: { params: Promise<{ eventSlug: string }> }) {
  const body = await readJsonObject(request);
  if (!body) return invalidRequest();

  const { eventSlug } = await context.params;
  const result = await getRaffleService().resendVerification({
    eventSlug,
    email: body.email,
    turnstileToken: body.turnstile_token,
    ipAddress: clientIpAddress(request),
  });

  return raffleRequestResponse(result);
}
