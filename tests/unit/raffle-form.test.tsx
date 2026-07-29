import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RaffleForm } from '../../components/public/raffle-form';
import { countryOptions } from '../../lib/i18n/countries';

const CAPTCHA_TOKEN = 'turnstile-test-token';

function stubTurnstile({ solve = true }: { solve?: boolean } = {}) {
  let issue: ((token: string) => void) | null = null;
  globalThis.turnstile = {
    render: (_element, options) => {
      issue = options.callback as (token: string) => void;
      if (solve) issue(CAPTCHA_TOKEN);
      else (options['error-callback'] as () => void)();
      return 'widget-1';
    },
    // Cloudflare hands back a new token after a reset; the form depends on it,
    // because a spent one cannot be verified twice.
    reset: () => {
      if (solve) issue?.(CAPTCHA_TOKEN);
    },
  };
}

function renderForm() {
  return render(
    <RaffleForm eventSlug="jfca-2026" turnstileSiteKey="site-key" countries={countryOptions()} />,
  );
}

function confirmInDialog(name: string) {
  // Scoped to the dialog on purpose: the form's own submit button is still on
  // the page behind it, and a query across the whole screen would be ambiguous
  // the moment the two labels overlap again.
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
}

async function fillAndOpenDialog(email = 'person@example.com') {
  fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: email } });
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send confirmation email' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send confirmation email' }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  stubTurnstile();
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.turnstile = undefined;
});

describe('information hierarchy', () => {
  it('puts the optional profile before the section that asks for an email', () => {
    renderForm();
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);

    // The profile section is a disclosure now, but it keeps its heading so it
    // is still reachable by heading navigation, and it announces that it can
    // be skipped without being opened first.
    expect(headings).toEqual([
      'Tell us a little about yourself (Optional)',
      'Get your Lucky Draw number',
    ]);
  });

  it('places every optional field above that heading', () => {
    renderForm();
    const numberHeading = screen.getByRole('heading', { name: 'Get your Lucky Draw number' });

    for (const label of [/First name/, /Last name/, /Phone number/, /Gender/, /Date of birth/, /Country/, /Province \/ State \/ Region/]) {
      const field = screen.getByLabelText(label);
      expect(numberHeading.compareDocumentPosition(field)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    }
  });

  it('starts with the optional fields collapsed, so the required one is reachable without scrolling', () => {
    renderForm();

    // The offer is still made first; it just costs one line rather than a
    // screenful on the phone almost every visitor arrives with.
    const section = screen.getByText('Tell us a little about yourself').closest('details');
    expect(section).not.toBeNull();
    expect(section).not.toHaveAttribute('open');
  });

  it('opens the optional fields when a restored draft has something in them', async () => {
    const first = renderForm();
    fireEvent.click(screen.getByText('Tell us a little about yourself'));
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Ada' } });
    first.unmount();

    renderForm();

    // Hiding a visitor's own restored answers behind a closed section would
    // read as having lost them.
    await waitFor(() =>
      expect(screen.getByText('Tell us a little about yourself').closest('details')).toHaveAttribute(
        'open',
      ),
    );
  });

  it('collects a country and region but never a street address', () => {
    renderForm();

    expect(screen.getByLabelText(/Province \/ State \/ Region/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/address line|street|postal code|zip/i)).toBeNull();
  });

  it('defaults the country to Canada', () => {
    renderForm();

    expect(screen.getByLabelText(/Country/)).toHaveValue('CA');
  });

  it('links the privacy policy and the event terms from the consent line', () => {
    renderForm();

    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      'https://livapon.com/policies/privacy-policy',
    );
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/jfca-2026/terms',
    );
  });
});

describe('required information', () => {
  it('keeps the send action disabled until the captcha, the email, and consent are all present', async () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Send confirmation email' });

    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'person@example.com' },
    });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('stays disabled when the captcha could not be solved', async () => {
    globalThis.turnstile = undefined;
    stubTurnstile({ solve: false });
    renderForm();

    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByRole('button', { name: 'Send confirmation email' })).toBeDisabled();
    expect(screen.getByText(/did not pass/i)).toBeInTheDocument();
  });
});

describe('sending', () => {
  it('confirms the exact address before anything is sent', async () => {
    renderForm();
    const dialog = await fillAndOpenDialog('Person@Example.com');

    expect(dialog).toHaveTextContent('Person@Example.com');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends nothing when the visitor goes back', async () => {
    renderForm();
    await fillAndOpenDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the entry with the captcha token and shows the generic acknowledgement', async () => {
    renderForm();
    await fillAndOpenDialog();

    confirmInDialog('Send email');

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/campaigns/jfca-2026/entries');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      email: 'person@example.com',
      terms_consent: true,
      country: 'CA',
      turnstile_token: CAPTCHA_TOKEN,
    });
  });

  it('reports a rate-limited attempt without losing what was typed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 429 })),
    );
    renderForm();
    await fillAndOpenDialog();

    confirmInDialog('Send email');

    await screen.findByText(/Too many attempts/);
    expect(screen.getByLabelText(/Email address/)).toHaveValue('person@example.com');
  });
});

describe('draft recovery', () => {
  it('restores what was typed after a reload in the same tab', () => {
    const first = renderForm();
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'person@example.com' },
    });
    first.unmount();

    renderForm();

    expect(screen.getByLabelText(/First name/)).toHaveValue('Ada');
    expect(screen.getByLabelText(/Email address/)).toHaveValue('person@example.com');
  });

  it('clears the draft once the entry has been accepted', async () => {
    const first = renderForm();
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Ada' } });
    await fillAndOpenDialog();
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });
    first.unmount();

    renderForm();

    expect(screen.getByLabelText(/First name/)).toHaveValue('');
    expect(screen.getByLabelText(/Email address/)).toHaveValue('');
  });
});

describe('resend', () => {
  it('asks again before sending the link a second time', async () => {
    renderForm();
    await fillAndOpenDialog();
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    // Sending spends the captcha token, so the resend button stays disabled
    // until Cloudflare hands back a fresh one — and a click on a disabled
    // button does nothing at all. Waiting for it is what the submit helper
    // above already does; without the same wait here the test passes alone and
    // fails under the load of the full suite.
    const resend = screen.getByRole('button', { name: 'Send it again' });
    await waitFor(() => expect(resend).toBeEnabled());
    fireEvent.click(resend);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('person@example.com');
    expect(fetch).toHaveBeenCalledTimes(1);

    confirmInDialog('Send again');

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(
      '/api/campaigns/jfca-2026/entries/resend',
    );
  });
});
