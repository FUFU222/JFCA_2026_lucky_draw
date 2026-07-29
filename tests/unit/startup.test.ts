import { describe, expect, it } from 'vitest';

import { assertRaffleConfiguration } from '../../lib/config/startup';

const productionEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  NEXT_PUBLIC_APP_URL: 'https://luckydraw.livapon.com',
  RESEND_API_KEY: 'resend-key',
  TURNSTILE_SECRET_KEY: 'a-real-turnstile-secret',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'a-real-turnstile-site-key',
  RECEIPT_TOKEN_SECRET: 'receipt-secret',
  VERIFICATION_TOKEN_SECRET: 'verification-secret',
  CRON_SECRET: 'cron-secret',
  MAIL_DELIVERY_MODE: 'send',
};

describe('assertRaffleConfiguration', () => {
  it('accepts a complete production environment', () => {
    expect(() => assertRaffleConfiguration(productionEnv, true)).not.toThrow();
  });

  it('refuses to start production with log delivery', () => {
    expect(() =>
      assertRaffleConfiguration({ ...productionEnv, MAIL_DELIVERY_MODE: 'log' }, true),
    ).toThrow('would discard every message in production');
  });

  it('refuses a Cloudflare test secret in production', () => {
    expect(() =>
      assertRaffleConfiguration(
        { ...productionEnv, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' },
        true,
      ),
    ).toThrow('Cloudflare test secret');
  });

  it('accepts the request limits when they are absent or valid', () => {
    expect(() => assertRaffleConfiguration(productionEnv, true)).not.toThrow();
    expect(() =>
      assertRaffleConfiguration({ ...productionEnv, RAFFLE_IP_REQUEST_LIMIT: '100000' }, true),
    ).not.toThrow();
    // Pasting into a dashboard leaves whitespace often enough to matter.
    expect(() =>
      assertRaffleConfiguration({ ...productionEnv, RAFFLE_IP_REQUEST_LIMIT: ' 100000\n' }, true),
    ).not.toThrow();
  });

  it('refuses a request limit that would silently fall back to the default', () => {
    // The failure this prevents is invisible: the venue's shared address hits
    // the default ceiling an hour in and nothing says why.
    // `1e5` is deliberately absent: it parses to exactly 100000, so it is
    // accepted rather than refused — the guard is about values that would fall
    // back, not about spelling.
    for (const bad of ['100,000', '100 000', '0', '-1', 'lots']) {
      expect(() =>
        assertRaffleConfiguration({ ...productionEnv, RAFFLE_IP_REQUEST_LIMIT: bad }, true),
      ).toThrow('RAFFLE_IP_REQUEST_LIMIT must be a positive integer');
    }
    expect(() =>
      assertRaffleConfiguration({ ...productionEnv, RAFFLE_EMAIL_REQUEST_LIMIT: 'five' }, true),
    ).toThrow('RAFFLE_EMAIL_REQUEST_LIMIT must be a positive integer');
  });

  it('catches a missing anon key, which otherwise only surfaces at an operator sign-in', () => {
    expect(() =>
      assertRaffleConfiguration({ ...productionEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: '' }, true),
    ).toThrow('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  });

  it('names every missing production variable at once', () => {
    expect(() =>
      assertRaffleConfiguration(
        { ...productionEnv, RECEIPT_TOKEN_SECRET: '', CRON_SECRET: '' },
        true,
      ),
    ).toThrow(/RECEIPT_TOKEN_SECRET is not set; CRON_SECRET is not set/);
  });

  it('rejects an unrecognized delivery mode in any environment', () => {
    expect(() =>
      assertRaffleConfiguration({ MAIL_DELIVERY_MODE: 'quiet' }, false),
    ).toThrow('MAIL_DELIVERY_MODE');
  });

  it('leaves development alone so the app runs without production credentials', () => {
    const development = { NODE_ENV: 'development' };

    expect(() =>
      assertRaffleConfiguration({ ...development, MAIL_DELIVERY_MODE: 'log' }, false),
    ).not.toThrow();
    expect(() => assertRaffleConfiguration(development, false)).not.toThrow();
  });
});
