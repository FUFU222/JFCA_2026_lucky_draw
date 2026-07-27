import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  requestVerification: vi.fn(),
  resendVerification: vi.fn(),
  confirmVerification: vi.fn(),
}));

vi.mock('../../lib/db/server', () => ({
  getRaffleService: () => service,
}));

import { POST as confirm } from '../../app/api/campaigns/[eventSlug]/verify/confirm/route';
import { POST as entry } from '../../app/api/campaigns/[eventSlug]/entries/route';
import { POST as resend } from '../../app/api/campaigns/[eventSlug]/entries/resend/route';

const params = Promise.resolve({ eventSlug: 'jfca-2026' });
const ACCEPTED_BODY = {
  ok: true,
  message: 'If eligible, check your email for a verification link.',
};

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validEntryBody = {
  email: 'PERSON@example.com',
  terms_consent: true,
  locale: 'en',
  turnstile_token: 'captcha',
};

describe('entry route', () => {
  beforeEach(() => vi.resetAllMocks());

  it('forwards the request and returns a stable generic acceptance', async () => {
    service.requestVerification.mockResolvedValue({ accepted: true });

    const response = await entry(
      post(
        '/api/campaigns/jfca-2026/entries',
        { ...validEntryBody, first_name: 'Ada' },
        { 'x-forwarded-for': '203.0.113.1, 70.41.3.18' },
      ),
      { params },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(ACCEPTED_BODY);
    expect(service.requestVerification).toHaveBeenCalledWith({
      eventSlug: 'jfca-2026',
      email: 'PERSON@example.com',
      locale: 'en',
      termsConsent: true,
      turnstileToken: 'captcha',
      // Only the client address is taken from the proxy chain.
      ipAddress: '203.0.113.1',
      firstName: 'Ada',
      lastName: undefined,
      phone: undefined,
      gender: undefined,
      dateOfBirth: undefined,
      country: undefined,
      region: undefined,
    });
  });

  it.each([
    ['invalid', 400, 'invalid_request'],
    ['turnstile', 403, 'captcha_failed'],
    ['rate_limited', 429, 'try_again_later'],
    ['closed', 403, 'registration_unavailable'],
  ])('maps the %s outcome to %i', async (reason, status, error) => {
    service.requestVerification.mockResolvedValue({ accepted: false, reason });

    const response = await entry(post('/api/campaigns/jfca-2026/entries', validEntryBody), {
      params,
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error });
  });

  it('rejects a body that is not a JSON object without calling the service', async () => {
    for (const body of ['not json', '"a string"', '[1,2,3]']) {
      const response = await entry(post('/api/campaigns/jfca-2026/entries', body), { params });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' });
    }
    expect(service.requestVerification).not.toHaveBeenCalled();
  });
});

describe('resend route', () => {
  beforeEach(() => vi.resetAllMocks());

  it('does not disclose an absent entry', async () => {
    service.resendVerification.mockResolvedValue({ accepted: true });

    const response = await resend(
      post('/api/campaigns/jfca-2026/entries/resend', {
        email: 'missing@example.com',
        turnstile_token: 'captcha',
      }),
      { params },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(ACCEPTED_BODY);
  });

  it('answers a rate-limited resend with the retry outcome', async () => {
    service.resendVerification.mockResolvedValue({ accepted: false, reason: 'rate_limited' });

    const response = await resend(
      post('/api/campaigns/jfca-2026/entries/resend', {
        email: 'person@example.com',
        turnstile_token: 'captcha',
      }),
      { params },
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, error: 'try_again_later' });
  });
});

describe('confirmation route', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the issued number and the permanent receipt token', async () => {
    service.confirmVerification.mockResolvedValue({
      number: BigInt(10_000),
      receiptToken: 'receipt-token',
    });

    const response = await confirm(
      post('/api/campaigns/jfca-2026/verify/confirm', { token: 'a'.repeat(43) }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      number: '10000',
      receipt_token: 'receipt-token',
    });
    expect(service.confirmVerification).toHaveBeenCalledWith({
      eventSlug: 'jfca-2026',
      token: 'a'.repeat(43),
    });
  });

  it('maps an unusable link to a safe response', async () => {
    service.confirmVerification.mockResolvedValue(null);

    const response = await confirm(
      post('/api/campaigns/jfca-2026/verify/confirm', { token: 'invalid' }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'verification_link_invalid' });
  });

  it('propagates a server fault instead of reporting a broken link', async () => {
    service.confirmVerification.mockRejectedValue(new Error('database unavailable'));

    await expect(
      confirm(post('/api/campaigns/jfca-2026/verify/confirm', { token: 'a'.repeat(43) }), {
        params,
      }),
    ).rejects.toThrow('database unavailable');
  });
});
