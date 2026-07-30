import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VerificationConfirmation } from '../../components/public/verification-confirmation';

/**
 * The hand-off is a full document navigation, not a router transition. On
 * production a confirm returned 200, the number was issued, and no request for
 * the receipt page was ever made — the soft navigation produced nothing at
 * all. `assign` is stubbed here for the same reason it is used there: it is
 * the one form of this that cannot silently do nothing.
 */
const assign = vi.fn();

function renderConfirmation() {
  return render(<VerificationConfirmation eventSlug="jfca-2026" token={'a'.repeat(43)} />);
}

/**
 * One press, no dialog. The page states the consequence above the button and
 * the button names the action, which is the whole confirmation.
 */
function pressGetMyNumber() {
  fireEvent.click(screen.getByRole('button', { name: 'Get my number' }));
}

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => {
  assign.mockClear();
  vi.stubGlobal('location', { assign } as unknown as Location);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VerificationConfirmation', () => {
  it('issues the number and navigates to the receipt', async () => {
    respondWith({ ok: true, receipt_token: 'receipt-token' });
    renderConfirmation();

    pressGetMyNumber();

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/jfca-2026/number/receipt-token'),
    );
  });

  it('keeps showing that it is working until the receipt page replaces it', async () => {
    respondWith({ ok: true, receipt_token: 'receipt-token' });
    renderConfirmation();

    pressGetMyNumber();
    await waitFor(() => expect(assign).toHaveBeenCalled());

    // The navigation is asynchronous. Releasing the busy state
    // here used to put this screen back — with a live, tappable button — for
    // the second or so the receipt page takes to paint, which reads as
    // "nothing happened" and invites a second tap.
    expect(screen.getByRole('button', { name: 'Issuing your number…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Get my number' })).toBeNull();
  });

  it('hands the screen back when the link turns out to be unusable', async () => {
    respondWith({ ok: false }, 400);
    renderConfirmation();

    pressGetMyNumber();

    // The opposite of the case above: nothing is going to replace this screen,
    // so it has to become usable again and say why.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('It may have expired'),
    );
    expect(screen.getByRole('button', { name: 'Get my number' })).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('hands the screen back when the request never reaches the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    renderConfirmation();

    pressGetMyNumber();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('could not be issued'),
    );
    expect(screen.getByRole('button', { name: 'Get my number' })).toBeEnabled();
  });
});
