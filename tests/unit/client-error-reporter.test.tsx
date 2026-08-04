import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientErrorReporter } from '../../components/observability/client-error-reporter';

function dispatchError(filename: string | undefined, message: string): void {
  window.dispatchEvent(new ErrorEvent('error', { message, filename, error: new Error(message) }));
}

function dispatchRejection(reason: unknown): void {
  const event = new Event('unhandledrejection') as unknown as PromiseRejectionEvent;
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
}

function fetchCalls() {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  render(<ClientErrorReporter />);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client error reporter', () => {
  it('reports a same-origin script error', () => {
    dispatchError(`${window.location.origin}/_next/static/chunk.js`, 'undefined is not a function');

    expect(fetchCalls()).toHaveLength(1);
    const [url, init] = fetchCalls()[0];
    expect(url).toBe('/api/client-error');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ message: 'undefined is not a function', path: window.location.pathname });
  });

  it('ignores an opaque cross-origin script error', () => {
    dispatchError(undefined, 'Script error.');

    expect(fetchCalls()).toHaveLength(0);
  });

  it('ignores an error whose script is on another origin', () => {
    dispatchError('https://evil.example/injected.js', 'boom');

    expect(fetchCalls()).toHaveLength(0);
  });

  it('reports an unhandled promise rejection', () => {
    dispatchRejection(new Error('fetch failed'));

    expect(fetchCalls()).toHaveLength(1);
    const body = JSON.parse(fetchCalls()[0][1].body as string);
    expect(body.message).toBe('fetch failed');
  });

  it('reports a rejection whose reason is not an Error', () => {
    dispatchRejection('a plain string reason');

    expect(fetchCalls()).toHaveLength(1);
    const body = JSON.parse(fetchCalls()[0][1].body as string);
    expect(body.message).toBe('a plain string reason');
  });
});
