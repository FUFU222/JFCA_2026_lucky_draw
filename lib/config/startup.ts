import { parseMailDeliveryMode } from '../email/mailer';
import { isCloudflareTestSecret } from '../security/turnstile';

/**
 * Configuration that must be wrong loudly rather than quietly. Every check here
 * describes a deployment that would otherwise look healthy while silently doing
 * the wrong thing: swallowing every message, or waving every visitor through
 * the bot challenge.
 */
export function assertRaffleConfiguration(
  env: Record<string, string | undefined> = process.env,
  isProduction = env.NODE_ENV === 'production',
): void {
  const problems: string[] = [];

  try {
    const mode = parseMailDeliveryMode(env.MAIL_DELIVERY_MODE);
    if (isProduction && mode === 'log') {
      problems.push('MAIL_DELIVERY_MODE=log would discard every message in production');
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'MAIL_DELIVERY_MODE is invalid');
  }

  // Both limits fall back to their default when the value will not parse, and
  // a silent fallback is the worst outcome here: the per-IP default is reached
  // within the first hour at venue scale, so an operator who raised it and
  // fat-fingered the value would find the shared wifi locked out mid-event
  // with nothing anywhere saying why. Set wrong is worse than not set.
  for (const name of ['RAFFLE_IP_REQUEST_LIMIT', 'RAFFLE_EMAIL_REQUEST_LIMIT']) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      problems.push(`${name} must be a positive integer, received "${raw}"`);
    }
  }

  if (isProduction) {
    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL',
      // Only the admin sign-in reads this, so a deploy without it boots
      // healthy, serves every visitor correctly, and fails the first time an
      // operator tries to sign in — which is the failure mode this check
      // exists to prevent.
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'NEXT_PUBLIC_APP_URL',
      'RESEND_API_KEY',
      'TURNSTILE_SECRET_KEY',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
      'RECEIPT_TOKEN_SECRET',
      'VERIFICATION_TOKEN_SECRET',
      'CRON_SECRET',
    ]) {
      if (!env[name]) problems.push(`${name} is not set`);
    }

    const turnstileSecret = env.TURNSTILE_SECRET_KEY;
    if (turnstileSecret && isCloudflareTestSecret(turnstileSecret)) {
      problems.push('TURNSTILE_SECRET_KEY is a Cloudflare test secret');
    }
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start: ${problems.join('; ')}`);
  }
}
