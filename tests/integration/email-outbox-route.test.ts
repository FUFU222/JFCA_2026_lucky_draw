import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processor = vi.hoisted(() => ({ process: vi.fn() }));

vi.mock('../../lib/db/server', () => ({
  getEmailOutboxProcessor: () => processor,
}));

import { GET, POST } from '../../app/api/internal/email-outbox/route';

const CRON_SECRET = 'cron-secret-value';

function request(authorization?: string) {
  return new Request('https://example.test/api/internal/email-outbox', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });
}

describe('email outbox cron endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('processes a bounded batch for an authorized caller', async () => {
    processor.process.mockResolvedValue({ claimed: 3, sent: 2, failed: 1 });

    const response = await POST(request(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, claimed: 3, sent: 2, failed: 1 });
    expect(processor.process).toHaveBeenCalledWith(20);
  });

  it('also answers GET, in case Vercel Cron ever calls this instead', async () => {
    processor.process.mockResolvedValue({ claimed: 0, sent: 0, failed: 0 });

    const response = await GET(request(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(200);
  });

  it.each([
    ['no header', undefined],
    ['a wrong secret', 'Bearer not-the-secret'],
    ['a secret of a different length', 'Bearer short'],
    ['a bare token without the scheme', CRON_SECRET],
  ])('refuses %s without touching the outbox', async (_label, authorization) => {
    const response = await POST(request(authorization));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('refuses everything when no secret is configured', async () => {
    delete process.env.CRON_SECRET;

    const response = await POST(request('Bearer anything'));

    expect(response.status).toBe(401);
    expect(processor.process).not.toHaveBeenCalled();
  });
});
