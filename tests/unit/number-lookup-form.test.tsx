import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NumberLookupForm } from '../../components/public/number-lookup-form';

const CAPTCHA_TOKEN = 'turnstile-test-token';

/** Solves the challenge synchronously, both on render and on reset. */
function stubTurnstile({ solve = true }: { solve?: boolean } = {}) {
  let issue: (() => void) | null = null;
  globalThis.turnstile = {
    render: (_element, options) => {
      issue = () => (options.callback as (token: string) => void)(CAPTCHA_TOKEN);
      if (solve) issue();
      else (options['error-callback'] as () => void)();
      return 'widget-1';
    },
    reset: () => {
      if (solve) issue?.();
    },
  };
}

function renderForm(props: Partial<Parameters<typeof NumberLookupForm>[0]> = {}) {
  return render(
    <NumberLookupForm
      eventSlug="jfca-2026"
      eventTitle="Japan Festival Canada 2026"
      turnstileSiteKey="site-key"
      {...props}
    />,
  );
}

function fillEmail(email = 'person@example.com') {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
}

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => {
  stubTurnstile();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NumberLookupForm', () => {
  it('stays disabled until an email looks usable and the challenge has passed', async () => {
    respondWith({ ok: true, found: false });
    renderForm();

    const submit = screen.getByRole('button', { name: 'Find my number' });
    expect(submit).toBeDisabled();

    fillEmail('not-an-email');
    expect(submit).toBeDisabled();

    fillEmail('person@example.com');
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('shows the ticket for a number that was found', async () => {
    respondWith({ ok: true, found: true, number: '10042' });
    renderForm();

    fillEmail();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find my number' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Find my number' }));

    await screen.findByText(/No\. 10042/);
    // The form itself is gone once the ticket is shown — nothing left to
    // resubmit, since a lookup is a one-shot disclosure of one number.
    expect(screen.queryByRole('button', { name: 'Find my number' })).not.toBeInTheDocument();
  });

  it('answers "not found" without implying whether the address ever entered', async () => {
    respondWith({ ok: true, found: false });
    renderForm();

    fillEmail();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find my number' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Find my number' }));

    await screen.findByText(
      'No ready number for that address yet. Check your confirmation email, or ask a staff member for help.',
    );
  });

  it('surfaces a rate-limit refusal distinctly from a generic failure', async () => {
    respondWith({ ok: false, error: 'try_again_later' }, 429);
    renderForm();

    fillEmail();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find my number' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Find my number' }));

    await screen.findByText(/Too many attempts from this network/);
  });

  it('tells the visitor to wait, not to switch networks, when the address itself is rate-limited', async () => {
    respondWith({ ok: false, error: 'try_again_later_address' }, 429);
    renderForm();

    fillEmail();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find my number' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Find my number' }));

    await screen.findByText(/already been checked several times today/);
  });

  it('sends no captcha token and renders no widget in test mode', async () => {
    respondWith({ ok: true, found: true, number: '900000001' });
    renderForm({ isTestMode: true });

    expect(screen.queryByTestId('turnstile-widget')).not.toBeInTheDocument();
    fillEmail();
    expect(screen.getByRole('button', { name: 'Find my number' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Find my number' }));

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body).not.toHaveProperty('turnstile_token');
    expect(body.is_test).toBe(true);

    await screen.findByText(/No\. 900000001/);
  });
});
