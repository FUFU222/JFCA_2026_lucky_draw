import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VerificationConfirmation } from '../../components/public/verification-confirmation';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

function renderConfirmation() {
  return render(<VerificationConfirmation eventSlug="jfca-2026" token={'a'.repeat(43)} />);
}

/** Opens the dialog and presses its action. */
function confirmInDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and get my number' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Get my number' }));
}

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => {
  replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VerificationConfirmation', () => {
  it('issues the number and navigates to the receipt', async () => {
    respondWith({ ok: true, receipt_token: 'receipt-token' });
    renderConfirmation();

    confirmInDialog();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/jfca-2026/number/receipt-token'),
    );
  });

  it('keeps showing that it is working until the receipt page replaces it', async () => {
    respondWith({ ok: true, receipt_token: 'receipt-token' });
    renderConfirmation();

    confirmInDialog();
    await waitFor(() => expect(replace).toHaveBeenCalled());

    // `router.replace` only starts the navigation. Releasing the busy state
    // here used to put this screen back — with a live, tappable button — for
    // the second or so the receipt page takes to paint, which reads as
    // "nothing happened" and invites a second tap.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Issuing your number…' })).toBeDisabled();
    // The button behind the dialog must not become tappable again either.
    expect(screen.queryByRole('button', { name: 'Confirm and get my number' })).toBeNull();
  });

  it('hands the screen back when the link turns out to be unusable', async () => {
    respondWith({ ok: false }, 400);
    renderConfirmation();

    confirmInDialog();

    // The opposite of the case above: nothing is going to replace this screen,
    // so it has to become usable again and say why.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('It may have expired'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm and get my number' })).toBeEnabled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('hands the screen back when the request never reaches the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    renderConfirmation();

    confirmInDialog();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('could not be issued'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm and get my number' })).toBeEnabled();
  });
});
