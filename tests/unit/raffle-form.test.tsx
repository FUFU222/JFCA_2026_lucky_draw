import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RaffleForm } from '../../components/public/raffle-form';
import { countryOptions } from '../../lib/i18n/countries';
import { RESEND_COOLDOWN_SECONDS } from '../../lib/raffle/limits';

// One token per challenge, never a constant. Cloudflare refuses a response
// token that has already been verified, which is the whole reason the widget
// resets — and with every challenge answering the same string, a regression
// that reused a spent token would look identical to correct behaviour.
const CAPTCHA_TOKEN = 'turnstile-test-token';
const tokenFor = (n: number) => `${CAPTCHA_TOKEN}-${n}`;

/**
 * `solveFirst` is how many renders hand back a token before the rest fail. The
 * captcha is rendered twice in a resend — once for the entry, once inside the
 * resend dialog — so failing only the second is what proves the dialog waits
 * on its own challenge rather than on a token left over from the entry.
 */
function stubTurnstile({
  solve = true,
  solveFirst = Number.POSITIVE_INFINITY,
  deferred = false,
}: { solve?: boolean; solveFirst?: number; deferred?: boolean } = {}) {
  let issue: ((token: string) => void) | null = null;
  let fail: (() => void) | null = null;
  let attempts = 0;

  // Render and reset both run a challenge, so both go through here. Counting
  // only renders would let a reset hand back a token the render was set up to
  // refuse, which is how the first version of this stub quietly disagreed with
  // itself.
  // Cloudflare does not answer inline. `deferred` holds the answer until the
  // test releases it, which is the only way to observe the window where the
  // action has to stay disabled — a microtask or a timer would be flushed by
  // the very `await` used to find the dialog.
  const pending: Array<() => void> = [];
  const attempt = () => {
    attempts += 1;
    const answer =
      solve && attempts <= solveFirst ? () => issue?.(tokenFor(attempts)) : () => fail?.();
    if (deferred) pending.push(answer);
    else answer();
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

  /** Releases whatever `deferred` is holding, from inside `act`. */
  return () => {
    const queued = pending.splice(0);
    queued.forEach((answer) => answer());
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
      turnstile_token: tokenFor(1),
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
  // The real submission already counts as a send server-side, so the button
  // is on cooldown the instant the acknowledgement screen appears — see
  // resendAvailableAt in raffle-form.tsx. Fake timers with real-time
  // advancement let `waitFor` keep working while the cooldown itself is
  // skipped forward instantly instead of the test taking two real minutes.
  beforeEach(() => {
    // An explicit `now` matters: without it the fake clock starts at epoch 0,
    // and `resendAvailableAt` (stamped from a real `Date.now()` inside the
    // component) would then sit decades ahead of every tick this test drives.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks again before sending the link a second time', async () => {
    renderForm();
    await fillAndOpenDialog();
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    // Nothing to wait on any more: the button only opens the dialog, and the
    // challenge that used to gate it has moved inside. The acknowledgement
    // screen everybody sees carries no captcha at all.
    expect(screen.queryByTestId('turnstile-widget')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_SECONDS * 1000);
    });
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
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1][0]).toBe('/api/campaigns/jfca-2026/entries/resend');

    // Two requests, two challenges. Sending the entry's token again would be
    // refused by Cloudflare, and with a constant stub token it would have read
    // exactly like success.
    const sentToken = (call: unknown[]) =>
      JSON.parse((call[1] as { body: string }).body).turnstile_token;
    expect(sentToken(calls[0])).toBeTruthy();
    expect(sentToken(calls[1])).not.toBe(sentToken(calls[0]));
  });

  it('keeps the action disabled until the challenge actually answers', async () => {
    // The default stub answers inside `render`, so the disabled window never
    // exists to be observed and asserting on it proves nothing. A deferred
    // answer is what the visitor meets.
    const answerChallenge = stubTurnstile({ deferred: true });
    renderForm();

    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(agreementCheckbox());
    // Nothing is sendable while Cloudflare has not answered, on this screen or
    // in the dialog.
    expect(screen.getByRole('button', { name: 'Send confirmation email' })).toBeDisabled();
    act(() => answerChallenge());

    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation email' }));
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_SECONDS * 1000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }));
    const dialog = await screen.findByRole('dialog');

    const send = within(dialog).getByRole('button', { name: 'Send again' });
    expect(send).toBeDisabled();
    expect(dialog).toHaveTextContent(/Checking your browser/i);

    act(() => answerChallenge());
    await waitFor(() => expect(send).toBeEnabled());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('will not open a second challenge while its own dialog is up', async () => {
    renderForm();
    await fillAndOpenDialog();
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_SECONDS * 1000);
    });
    const resend = screen.getByRole('button', { name: 'Send it again' });
    fireEvent.click(resend);
    await screen.findByRole('dialog');

    // The backdrop covers this button, but iOS still aims the second half of a
    // fast double-tap at the original target, and a second press would run a
    // second challenge against the shared per-IP budget.
    expect(resend).toBeDisabled();
  });

  it('will not resend on a challenge that failed, and still lets the visitor out', async () => {
    stubTurnstile({ solveFirst: 1 });
    renderForm();
    await fillAndOpenDialog();
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_SECONDS * 1000);
    });

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

  it('disables the resend button on cooldown instead of spending one of the five daily attempts on a click the server would silently drop', async () => {
    renderForm();
    await fillAndOpenDialog();
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    // The original submission already counts as a send server-side
    // (claim_verification_send), so the button must not invite an immediate
    // second one.
    expect(screen.queryByRole('button', { name: 'Send it again' })).not.toBeInTheDocument();
    const waiting = screen.getByRole('button', { name: /You can request another in/ });
    expect(waiting).toBeDisabled();
    // Tolerant of the sub-second gap between mount and the submission
    // actually completing — the tick that corrects it runs a second later.
    expect(waiting).toHaveTextContent(/^You can request another in 2:0[01]$/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90 * 1000);
    });
    expect(screen.getByRole('button', { name: /You can request another in/ })).toHaveTextContent(
      /^You can request another in 0:3[01]$/,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 1000);
    });
    const resend = screen.getByRole('button', { name: 'Send it again' });
    expect(resend).toBeEnabled();

    // A real click starts the same cooldown over again.
    fireEvent.click(resend);
    await screen.findByRole('dialog');
    confirmInDialog('Send again');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      screen.getByRole('button', { name: /You can request another in/ }),
    ).toBeDisabled();
  });

  it('keeps the same cooldown after a reload, so retyping the address into the primary form cannot spend the attempt the server would silently drop', async () => {
    const { unmount } = renderForm();
    await fillAndOpenDialog('reload-check@example.com');
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    // The draft itself is cleared on a successful submission — session
    // storage keeps only the cooldown, not the form fields — so a reload
    // lands back on an empty form, same as a real one would.
    unmount();
    renderForm();
    expect(screen.getByRole('heading', { name: 'Get your Lucky Draw number' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'reload-check@example.com' },
    });
    fireEvent.click(agreementCheckbox());
    const submit = screen.getByRole('button', { name: /You can request another in/ });
    expect(submit).toBeDisabled();

    // A different address was never sent anything, so it is not on cooldown.
    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: 'someone-else@example.com' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send confirmation email' })).toBeEnabled(),
    );
  });
});

describe('recovering from an expired link', () => {
  it('always shows the way back to the form, not only once a resend has been tried', async () => {
    renderForm();
    await fillAndOpenDialog('expired-check@example.com');
    confirmInDialog('Send email');
    await screen.findByRole('heading', { name: 'Check your email' });

    // `resendVerification` never revives an expired token — it silently
    // no-ops the same way it does for every other outcome it will not
    // disclose. Nothing on this screen can tell a visitor that a resend
    // failed for that reason, so the way out has to be offered up front.
    expect(screen.getByText('Still nothing after a day? The link may have expired.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enter your email again' }));

    // Back on the entry form, with the address the visitor already typed
    // still there — they are not starting over from a blank field.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Get your Lucky Draw number' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/Email address/)).toHaveValue('expired-check@example.com');
  });

  it('still honours the resend cooldown for the same address after using it', async () => {
    // The button exists precisely so a visitor does not have to understand
    // *why* resending is not working — but it must not become a backdoor
    // around the cooldown the resend button next to it enforces for the
    // exact same reason: `resendVerification` charges the same daily
    // allowance regardless of which button triggered it.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.now() });
    try {
      renderForm();
      await fillAndOpenDialog('cooldown-then-again@example.com');
      confirmInDialog('Send email');
      await screen.findByRole('heading', { name: 'Check your email' });

      fireEvent.click(screen.getByRole('button', { name: 'Enter your email again' }));
      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: 'Get your Lucky Draw number' }),
        ).toBeInTheDocument(),
      );

      fireEvent.click(agreementCheckbox());
      expect(
        screen.getByRole('button', { name: /You can request another in/ }),
      ).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
