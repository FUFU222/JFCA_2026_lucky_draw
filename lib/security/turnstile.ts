const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Registration waits on this call, so a stalled Cloudflare must fail the
 * request quickly instead of holding a serverless invocation open.
 */
const VERIFY_TIMEOUT_MS = 5_000;

/**
 * Cloudflare's published non-production secrets. They always return a fixed
 * verdict, so production must refuse to start a verification with any of them
 * rather than silently accepting every visitor.
 */
const CLOUDFLARE_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

export function isCloudflareTestSecret(secret: string): boolean {
  return CLOUDFLARE_TEST_SECRETS.has(secret);
}

export class TurnstileVerifier {
  constructor(
    private readonly secret = process.env.TURNSTILE_SECRET_KEY,
    private readonly fetcher: typeof fetch = fetch,
    private readonly production = process.env.NODE_ENV === 'production',
  ) {}

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    if (!token || !this.secret) return false;
    if (this.production && isCloudflareTestSecret(this.secret)) return false;

    try {
      const body = new URLSearchParams({ secret: this.secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      const response = await this.fetcher(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      return response.ok && ((await response.json()) as { success?: boolean }).success === true;
    } catch {
      // A network failure must never let an unverified write through.
      return false;
    }
  }
}
