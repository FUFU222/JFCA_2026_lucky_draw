import { getRaffleService } from '../../../../../../lib/db/server';
import {
  clientIpAddress,
  invalidRequest,
  raffleRequestResponse,
  readJsonObject,
} from '../../../_shared';

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
  const result = await getRaffleService().resendVerification({
    eventSlug,
    email: body.email,
    turnstileToken: body.turnstile_token,
    ipAddress: clientIpAddress(request),
  });

  return raffleRequestResponse(result);
}
