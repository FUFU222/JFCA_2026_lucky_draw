import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RaffleForm } from '../../components/public/raffle-form';
import { countryOptions } from '../../lib/i18n/countries';

const CAPTCHA_TOKEN = 'turnstile-test-token';

/**
 * `solveFirst` is how many renders hand back a token before the rest fail. The
 * captcha is rendered twice in a resend — once for the entry, once inside the
 * resend dialog — so failing only the second is what proves the dialog waits
 * on its own challenge rather than on a token left over from the entry.
 */
function stubTurnstile({
  solve = true,
  solveFirst = Number.POSITIVE_INFINITY,
}: { solve?: boolean; solveFirst?: number } = {}) {
  let issue: ((token: string) => void) | null = null;
  let fail: (() => void) | null = null;
  let attempts = 0;

  // Render and reset both run a challenge, so both go through here. Counting
  // only renders would let a reset hand back a token the render was set up to
  // refuse, which is how the first version of this stub quietly disagreed with
  // itself.
  const attempt = () => {
    attempts += 1;
    if (solve && attempts <= solveFirst) issue?.(CAPTCHA_TOKEN);
    else fail?.();
  };

  globalThis.turnstile = {
    render: (_element, options) => {
      issue = options.callback as (token: string) => void;
      fail = options['error-callback'] as () => void;
      attempt();
      return 'widget-1';
    },
    // Cloudflare hands back a new token after a reset; the form depends on it,
    // because a spent one cannot be verified twice.
    reset: attempt,
  };
}

function renderForm() {
  return render(
    <RaffleForm eventSlug="jfca-2026" turnstileSiteKey="site-key" countries={countryOptions()} />,
  );
}

/**
 * The required agreement, not the optional marketing box beside it. Entry is
 * conditional on this one only, so a query that could match either would let a
 * regression in that distinction pass unnoticed.
 */
function agreementCheckbox() {
  return screen.getAllByRole('checkbox')[0];
}

function marketingCheckbox() {
  return screen.getAllByRole('checkbox')[1];
}

function confirmInDialog(name: string) {
  // Scoped to the dialog on purpose: the form's own submit button is still on
  // the page behind it, and a query across the whole screen would be ambiguous
  // the moment the two labels overlap again.
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
}

async function fillAndOpenDialog(email = 'person@example.com') {
  fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: email } });
  fireEvent.click(agreementCheckbox());
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

    fireEvent.click(agreementCheckbox());
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('never makes the marketing box a condition of entering', async () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Send confirmation email' });

    expect(marketingCheckbox()).not.toBeChecked();

    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(agreementCheckbox());

    // Entering the draw and agreeing to be marketed at are separate acts. The
    // event is in Canada, where consent to commercial email cannot be bundled
    // into the thing the visitor actually came for.
    await waitFor(() => expect(submit).toBeEnabled());
    expect(marketingCheckbox()).not.toBeChecked();
  });

  it('sends the marketing answer the visitor actually gave', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(agreementCheckbox());
    fireEvent.click(marketingCheckbox());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send confirmation email' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation email' }));
    await screen.findByRole('dialog');
    confirmInDialog('Send email');

    await screen.findByRole('heading', { name: 'Check your email' });
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      marketing_consent: true,
    });
  });

  it('stays disabled when the captcha could not be solved', async () => {
    globalThis.turnstile = undefined;
    stubTurnstile({ solve: false });
    renderForm();

    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(agreementCheckbox());

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

    // Nothing to wait on any more: the button only opens the dialog, and the
    // challenge that used to gate it has moved inside. The acknowledgement
    // screen everybody sees carries no captcha at all.
    expect(screen.queryByTestId('turnstile-widget')).not.toBeInTheDocument();

    const resend = screen.getByRole('button', { name: 'Send it again' });
    expect(resend).toBeEnabled();
    fireEvent.click(resend);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('person@example.com');
    expect(within(dialog).getByTestId('turnstile-widget')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Send again' })).toBeEnabled(),
    );
    confirmInDialog('Send again');

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(
      '/api/campaigns/jfca-2026/entries/resend',
    );
  });

  it('will not resend on a challenge that failed, and still lets the visitor out', async () => {
    stubTurnstile({ solveFirst: 1 });
    renderForm();
    await fillAndOpenDialog();
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }));
    const dialog = await screen.findByRole('dialog');

    // No token, so nothing can be sent — but cancel has to stay live. Using
    // the dialog's `busy` state here would have disabled the way out too, and
    // a failed challenge is exactly when somebody needs it.
    await waitFor(() => expect(dialog).toHaveTextContent(/check did not pass/i));
    expect(within(dialog).getByRole('button', { name: 'Send again' })).toBeDisabled();
    const cancel = within(dialog).getByRole('button', { name: 'Go back' });
    expect(cancel).toBeEnabled();

    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
