import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimiter = vi.hoisted(() => ({ consume: vi.fn() }));
const reportServerError = vi.hoisted(() => vi.fn());

vi.mock('../../lib/raffle/rate-limit', () => ({
  // A constructor mock: arrow functions cannot be invoked with `new`, so this
  // has to be a plain function, whose explicit object return replaces the
  // `this` the `new` expression would otherwise have produced.
  SupabaseRateLimiter: vi.fn().mockImplementation(function SupabaseRateLimiterMock() {
    return rateLimiter;
  }),
}));

vi.mock('../../lib/db/server', () => ({
  createServiceRoleClient: () => ({}),
}));

vi.mock('../../lib/observability/report', () => ({
  reportServerError,
}));

import { POST } from '../../app/api/client-error/route';

function request(body: unknown, ip = '203.0.113.5') {
  return new Request('https://example.test/api/client-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify(body),
  });
}

describe('client error report endpoint', () => {
  beforeEach(() => {
    // Not resetAllMocks: that would also strip the mockImplementation on
    // SupabaseRateLimiter itself (set once, in the vi.mock factory above),
    // leaving `new SupabaseRateLimiter()` construct a bare, method-less mock.
    vi.clearAllMocks();
    rateLimiter.consume.mockResolvedValue(true);
  });

  it('reports a browser-side error under the client: route prefix', async () => {
    const response = await POST(
      request({ message: 'boom', stack: 'Error: boom\n at x', path: '/summer-festival' }),
    );

    expect(response.status).toBe(200);
    expect(reportServerError).toHaveBeenCalledTimes(1);
    const [error, context] = reportServerError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('boom');
    expect(context).toEqual({ route: 'client:/summer-festival', kind: 'client' });
  });

  it('redacts a bearer token embedded in the reported path', async () => {
    const token = 'a'.repeat(43);

    await POST(request({ message: 'boom', path: `/summer-festival/verify/${token}` }));

    const [, context] = reportServerError.mock.calls[0];
    expect(context.route).toBe('client:/summer-festival/verify/[token]');
  });

  it('refuses a request once the per-IP allowance for this window is spent', async () => {
    rateLimiter.consume.mockResolvedValue(false);

    const response = await POST(request({ message: 'boom' }));

    expect(response.status).toBe(429);
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it('rejects a body with no message rather than reporting an empty fault', async () => {
    const response = await POST(request({ stack: 'x' }));

    expect(response.status).toBe(400);
    expect(reportServerError).not.toHaveBeenCalled();
  });
});
