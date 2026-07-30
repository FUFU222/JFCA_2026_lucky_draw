import { describe, expect, it } from 'vitest';

import {
  AlertThrottle,
  fingerprintError,
  formatAlert,
  redactSensitive,
  summarizeError,
} from '../../lib/observability/alerts';
import {
  DEFAULT_OUTBOX_BACKLOG_THRESHOLD,
  evaluateHealth,
  outboxBacklogThreshold,
  type HealthSnapshot,
} from '../../lib/observability/health';

const healthy: HealthSnapshot = {
  database: { ok: true, latencyMs: 12, error: null },
  campaign: { found: true, status: 'SCHEDULED', accepting: true },
  outboxWaiting: 0,
  errorTrackingEnabled: true,
};

describe('redacting an alert', () => {
  it('removes an entrant address, which is the value most likely to be in a message', () => {
    expect(redactSensitive('duplicate email visitor@example.com for campaign')).toBe(
      'duplicate email [email] for campaign',
    );
  });

  it('removes credentials by shape as well as by known prefix', () => {
    expect(redactSensitive('key re_abcdef123456 rejected')).toBe('key [resend-key] rejected');
    expect(redactSensitive('Authorization: Bearer supersecretvalue')).toContain(
      'Bearer [redacted]',
    );
    expect(redactSensitive(`hash ${'a'.repeat(64)} mismatch`)).toBe('hash [token] mismatch');
  });

  it('keeps a UUID, because it is what makes an alert actionable and is not a secret', () => {
    const id = '3f1c9a54-8b2d-4e77-9f10-2c6b5d8e4a31';
    expect(redactSensitive(`entry ${id} failed`)).toBe(`entry ${id} failed`);
  });

  it('truncates rather than pasting an essay into a chat channel', () => {
    expect(redactSensitive('x'.repeat(900)).length).toBeLessThan(420);
  });
});

describe('grouping faults', () => {
  it('treats occurrences that differ only by a number as one fault', () => {
    const first = fingerprintError('Error', 'row 41 is missing', 'POST /entries');
    const second = fingerprintError('Error', 'row 8127 is missing', 'POST /entries');
    expect(first).toBe(second);
  });

  it('separates the same message on different routes', () => {
    expect(fingerprintError('Error', 'boom', 'POST /a')).not.toBe(
      fingerprintError('Error', 'boom', 'POST /b'),
    );
  });

  it('summarises a thrown non-Error, which a rejected fetch produces', () => {
    const summary = summarizeError('socket hang up', 'POST /entries');
    expect(summary.name).toBe('string');
    expect(summary.message).toBe('socket hang up');
  });

  it('redacts before fingerprinting, so one fault cannot look like a thousand', () => {
    const a = summarizeError(new Error('a@example.com already entered'), 'POST /entries');
    const b = summarizeError(new Error('b@example.org already entered'), 'POST /entries');
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.message).not.toContain('@example.com');
  });
});

describe('throttling the alert channel', () => {
  it('sends the first occurrence and holds the rest for the cooldown', () => {
    const throttle = new AlertThrottle({ cooldownMs: 1000 });

    expect(throttle.decide('f', 0)).toEqual({ send: true, suppressed: 0 });
    expect(throttle.decide('f', 500).send).toBe(false);
    expect(throttle.decide('f', 999).send).toBe(false);
    // …and says how many it swallowed, so one line cannot read as a one-off.
    expect(throttle.decide('f', 1000)).toEqual({ send: true, suppressed: 2 });
  });

  it('does not let one fault silence another', () => {
    const throttle = new AlertThrottle({ cooldownMs: 1000 });
    expect(throttle.decide('a', 0).send).toBe(true);
    expect(throttle.decide('b', 0).send).toBe(true);
  });

  it('caps the channel across all faults, so an outage cannot flood it', () => {
    const throttle = new AlertThrottle({ cooldownMs: 0, maxPerWindow: 2, windowMs: 1000 });

    expect(throttle.decide('a', 0).send).toBe(true);
    expect(throttle.decide('b', 0).send).toBe(true);
    expect(throttle.decide('c', 0).send).toBe(false);
    // The window rolls over and the channel opens again.
    expect(throttle.decide('c', 1000).send).toBe(true);
  });

  it('names the route and the suppressed count in the line a human reads', () => {
    const summary = summarizeError(new Error('boom'), 'POST /api/campaigns/x/entries');
    const line = formatAlert(summary, { suppressed: 3, appUrl: 'https://example.com' });

    expect(line).toContain('POST /api/campaigns/x/entries');
    expect(line).toContain('3 more');
    expect(line).toContain('https://example.com');
  });
});

describe('health verdict', () => {
  it('is ok when the database answers and nothing is queued', () => {
    expect(evaluateHealth(healthy)).toEqual({ status: 'ok', httpStatus: 200, reasons: [] });
  });

  it('is down, with a 503, when the database cannot be reached', () => {
    const verdict = evaluateHealth({
      ...healthy,
      database: { ok: false, latencyMs: 4000, error: 'timeout' },
    });

    expect(verdict.status).toBe('down');
    expect(verdict.httpStatus).toBe(503);
  });

  it('is down when the campaign row is missing, because the printed QR code resolves to nothing', () => {
    const verdict = evaluateHealth({
      ...healthy,
      campaign: { found: false, status: null, accepting: false },
    });

    expect(verdict.status).toBe('down');
    expect(verdict.httpStatus).toBe(503);
  });

  it('is degraded, but still 200, when mail is piling up', () => {
    const verdict = evaluateHealth({ ...healthy, outboxWaiting: 51 }, 50);

    expect(verdict.status).toBe('degraded');
    expect(verdict.httpStatus).toBe(200);
    expect(verdict.reasons[0]).toContain('51');
  });

  it('is degraded when the queue depth cannot be read at all', () => {
    expect(evaluateHealth({ ...healthy, outboxWaiting: null }).status).toBe('degraded');
  });

  it('never treats a closed campaign as unhealthy, so the alarm survives to the event', () => {
    // Every day but one, this is the normal state of the system.
    const closed = evaluateHealth({
      ...healthy,
      campaign: { found: true, status: 'CLOSED', accepting: false },
    });

    expect(closed.status).toBe('ok');
    expect(closed.httpStatus).toBe(200);
  });
});

describe('backlog threshold', () => {
  it('reads a positive integer', () => {
    expect(outboxBacklogThreshold({ OUTBOX_BACKLOG_THRESHOLD: ' 200 ' })).toBe(200);
  });

  it('falls back rather than failing, because a wrong value here only mislabels a gauge', () => {
    expect(outboxBacklogThreshold({ OUTBOX_BACKLOG_THRESHOLD: 'lots' })).toBe(
      DEFAULT_OUTBOX_BACKLOG_THRESHOLD,
    );
    expect(outboxBacklogThreshold({ OUTBOX_BACKLOG_THRESHOLD: '-5' })).toBe(
      DEFAULT_OUTBOX_BACKLOG_THRESHOLD,
    );
    expect(outboxBacklogThreshold({})).toBe(DEFAULT_OUTBOX_BACKLOG_THRESHOLD);
  });
});
