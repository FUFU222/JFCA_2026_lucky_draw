import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Set before the module under test is imported: `ALERT_WEBHOOK_URL` is read
// once, at call time, by `notify()`, but this keeps the test self-contained
// rather than relying on the environment it happens to run in.
process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/webhook';

import { reportServerError } from '../../lib/observability/report';

describe('reportServerError alert throttling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * `reportServerError` is the one function a public, unauthenticated
   * endpoint (`/api/client-error`) can reach. If it shared its throttle
   * budget with every other caller, a flood of fabricated client errors
   * could spend the shared hourly cap and silently suppress a real
   * server-side alert for the rest of the window — this is the property
   * that has to hold to prevent that.
   */
  it('keeps a flood of client-reported faults from spending the server alert budget', async () => {
    // The client budget is 10 per hour; a distinct route per call avoids the
    // per-fingerprint cooldown so every one of these is its own attempt.
    // (The route, unlike the message, is not digit-collapsed when the
    // fingerprint is derived — see `fingerprintError` in lib/observability/alerts.ts.)
    for (let i = 0; i < 15; i += 1) {
      await reportServerError(new Error('client fault'), { route: `/x-${i}`, kind: 'client' });
    }

    const callsAfterFlood = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFlood).toBe(10);

    await reportServerError(new Error('a genuine server fault'), { route: 'POST /api/x' });

    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFlood + 1);
  });
});
