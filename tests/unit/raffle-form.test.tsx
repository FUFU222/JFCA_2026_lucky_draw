import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RaffleForm } from '../../components/public/raffle-form';
import { countryOptions } from '../../lib/i18n/countries';

const CAPTCHA_TOKEN = 'turnstile-test-token';

function stubTurnstile({ solve = true }: { solve?: boolean } = {}) {
  globalThis.turnstile = {
    render: (_element, options) => {
      if (solve) (options.callback as (token: string) => void)(CAPTCHA_TOKEN);
      else (options['error-callback'] as () => void)();
      return 'widget-1';
    },
  };
}

function renderForm() {
  return render(
    <RaffleForm
      eventSlug="jfca-2026"
      locale="en"
      turnstileSiteKey="site-key"
      countries={countryOptions('en')}
    />,
  );
}

function confirmInDialog(name: string) {
  // The form's submit button and the dialog's action share a label, which is
  // exactly right for the visitor; the test has to say which one it means.
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

    expect(headings).toEqual([
      'Tell us a little about yourself',
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

    confirmInDialog('Send confirmation email');

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/campaigns/jfca-2026/entries');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      email: 'person@example.com',
      terms_consent: true,
      locale: 'en',
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

    confirmInDialog('Send confirmation email');

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
    confirmInDialog('Send confirmation email');
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
    confirmInDialog('Send confirmation email');
    await screen.findByRole('heading', { name: 'Check your email' });

    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }));
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
