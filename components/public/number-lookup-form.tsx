'use client';

import { useState } from 'react';

import { SaveableTicket } from './saveable-ticket';
import { TurnstileWidget } from './turnstile-widget';
import { Spinner } from '../ui/spinner';
import { messages } from '../../lib/i18n/messages';

export interface NumberLookupFormProps {
  eventSlug: string;
  eventTitle: string;
  turnstileSiteKey: string;
  /**
   * Set only by the server after re-checking an operator session for
   * `?test=1` — see `app/[eventSlug]/lookup/page.tsx`. The server re-verifies
   * this claim independently before honoring it, so the prop alone grants
   * nothing.
   */
  isTestMode?: boolean;
}

type Result = { state: 'idle' } | { state: 'found'; number: bigint } | { state: 'not_found' };

/**
 * Deliberately its own page rather than a mode of the entry form. The two
 * forms would otherwise share one email box and one button meaning two
 * different things, and a mistyped address would silently turn a lookup into
 * a second entry. This one asks for nothing but an address, because that is
 * all it needs.
 *
 * The captcha stays visible on the page rather than moving behind a
 * confirmation step, unlike the entry form's resend: this page has no
 * irreversible action to confirm, and it is already the rare, single-purpose
 * screen that justifies hiding a challenge elsewhere.
 */
export function NumberLookupForm({
  eventSlug,
  eventTitle,
  turnstileSiteKey,
  isTestMode = false,
}: NumberLookupFormProps) {
  const t = messages.lookup;

  const [email, setEmail] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ state: 'idle' });

  const emailLooksUsable = /.+@.+\..+/.test(email.trim());
  const canSubmit = (isTestMode || Boolean(captchaToken)) && emailLooksUsable && !checking;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setChecking(true);
    try {
      const response = await fetch(`/api/campaigns/${eventSlug}/lookup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          ...(isTestMode ? {} : { turnstile_token: captchaToken }),
          is_test: isTestMode,
        }),
      });

      // Cloudflare will not verify the same response token twice, so it is
      // spent the moment the request leaves, whatever the answer is.
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        found?: boolean;
        number?: string;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setError(errorFor(payload.error, response.status));
        return;
      }

      setResult(payload.found ? { state: 'found', number: BigInt(payload.number ?? '0') } : { state: 'not_found' });
    } catch {
      setError(t.errorGeneric);
    } finally {
      setChecking(false);
    }
  }

  if (result.state === 'found') {
    return (
      <div className="space-y-5">
        <SaveableTicket number={result.number} eventTitle={eventTitle} />
        {/* Same fact, same importance as on the page reached right after
            confirming — a visitor arriving here by lookup instead has no
            less reason to know it. */}
        <p className="text-[15px] leading-relaxed text-neutral-800">{messages.receipt.venue}</p>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      {isTestMode && (
        <div
          role="status"
          className="rounded-lg border-2 border-dashed border-[var(--brand-accent)] bg-[var(--brand-tint)] px-4 py-3 text-sm font-semibold text-[var(--brand-accent)]"
        >
          Test mode — the captcha check below is skipped.
        </div>
      )}

      <h1 className="text-2xl font-bold text-neutral-900">{t.heading}</h1>
      <p className="text-[15px] leading-relaxed text-neutral-700">{t.body}</p>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="lookup-email" className="block text-sm font-medium text-neutral-800">
            {t.email}
          </label>
          <input
            id="lookup-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base text-neutral-900"
          />
        </div>

        {result.state === 'not_found' && (
          <p role="status" className="rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-600">
            {t.notFound}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-[#c8102e]">
            {error}
          </p>
        )}

        {!isTestMode && (
          <div className="overflow-x-auto">
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              resetKey={captchaRound}
              onToken={(token) => {
                setCaptchaToken(token);
                if (token) setCaptchaFailed(false);
              }}
              onError={() => {
                setCaptchaToken(null);
                setCaptchaFailed(true);
              }}
            />
            {captchaFailed && (
              <p className="mt-2 text-sm text-neutral-600" role="status">
                {messages.form.captchaFailed}
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex min-h-12 w-full items-center justify-center rounded-lg bg-[var(--brand-accent)] px-5 text-base font-semibold text-white disabled:opacity-40"
        >
          <span className="inline-flex items-center justify-center gap-2">
            {checking && <Spinner />}
            {checking ? t.submitting : t.submit}
          </span>
        </button>
      </form>
    </section>
  );
}

function errorFor(code: string | undefined, status: number): string {
  const t = messages.lookup;
  switch (code) {
    case 'captcha_failed':
      return messages.form.captchaFailed;
    case 'try_again_later':
      return t.errorRateLimited;
    case 'try_again_later_address':
      return t.errorRateLimitedAddress;
    default:
      return status === 429 ? t.errorRateLimited : t.errorGeneric;
  }
}
