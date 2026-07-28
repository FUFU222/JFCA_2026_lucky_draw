'use client';

import { useEffect, useState } from 'react';

import { TurnstileWidget } from './turnstile-widget';
import { ConfirmationDialog } from '../ui/confirmation-dialog';
import { PRIVACY_POLICY_URL } from '../../lib/campaign/legal';
import { DEFAULT_COUNTRY, type CountryOption } from '../../lib/i18n/countries';
import { messagesFor, type Locale } from '../../lib/i18n/messages';

type Draft = {
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  country: string;
  region: string;
  email: string;
  consent: boolean;
};

const EMPTY_DRAFT: Draft = {
  firstName: '',
  lastName: '',
  phone: '',
  gender: '',
  dateOfBirth: '',
  country: DEFAULT_COUNTRY,
  region: '',
  email: '',
  consent: false,
};

/**
 * The draft lives in session storage, so a reload or a mis-tap restores it but
 * closing the tab does not leave someone's address on a shared phone.
 */
function draftKey(eventSlug: string) {
  return `livapon:lucky-draw:${eventSlug}:draft`;
}

function readDraft(eventSlug: string): Draft {
  if (typeof window === 'undefined') return EMPTY_DRAFT;
  try {
    const stored = window.sessionStorage.getItem(draftKey(eventSlug));
    return stored ? { ...EMPTY_DRAFT, ...(JSON.parse(stored) as Partial<Draft>) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export interface RaffleFormProps {
  eventSlug: string;
  locale: Locale;
  turnstileSiteKey: string;
  /**
   * Resolved on the server. Country names come from ICU data, and Node's copy
   * does not always agree with the browser's, so recomputing them here would
   * make the markup differ from what was sent and break hydration.
   */
  countries: readonly CountryOption[];
}

type Status = 'editing' | 'sending' | 'submitted';
type Screen = 'form' | 'submitted';

export function RaffleForm({
  eventSlug,
  locale,
  turnstileSiteKey,
  countries,
}: RaffleFormProps) {
  const t = messagesFor(locale).form;
  const submitted = messagesFor(locale).submitted;
  const sendDialog = messagesFor(locale).sendDialog;

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [status, setStatus] = useState<Status>('editing');
  const [screen, setScreen] = useState<Screen>('form');
  const [dialog, setDialog] = useState<'none' | 'send' | 'resend'>('none');
  const [error, setError] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);

  // The draft is read after mounting, never during the first render: the server
  // cannot see session storage, and rendering a different value here would make
  // React throw the whole tree away. Adopting client-only state on mount is the
  // case this rule exists to make deliberate, and it runs exactly once.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- adopting client-only
       state on mount is exactly the case this rule asks you to make deliberate.
       `restored` must be state rather than a ref: the save effect below runs in
       the same pass, and only a re-render makes the restored draft visible to
       it before it writes anything back. */
    setDraft(readDraft(eventSlug));
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [eventSlug]);

  useEffect(() => {
    if (!restored || status === 'submitted') return;
    try {
      window.sessionStorage.setItem(draftKey(eventSlug), JSON.stringify(draft));
    } catch {
      // A browser with storage disabled still has to be able to enter.
    }
  }, [draft, eventSlug, restored, status]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const emailLooksUsable = /.+@.+\..+/.test(draft.email.trim());
  const canSend = Boolean(captchaToken) && emailLooksUsable && draft.consent && status !== 'sending';

  async function post(path: string, body: Record<string, unknown>) {
    setError(null);
    setStatus('sending');
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      // Cloudflare will not verify the same response token twice, so it is
      // spent the moment the request leaves, whatever the answer is.
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);

      if (response.status === 202) return true;

      // The status alone cannot tell a failed challenge from a closed event —
      // both are 403 — and telling a visitor the raffle is closed while it is
      // running is the worst answer available. The body says which it is.
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(errorFor(payload.error, response.status, t));
      return false;
    } catch {
      setError(t.errorGeneric);
      return false;
    } finally {
      setStatus((current) => (current === 'sending' ? 'editing' : current));
    }
  }

  async function submitEntry() {
    setDialog('none');
    const accepted = await post(`/api/campaigns/${eventSlug}/entries`, {
      email: draft.email.trim(),
      terms_consent: true,
      locale,
      first_name: draft.firstName,
      last_name: draft.lastName,
      phone: draft.phone,
      gender: draft.gender,
      date_of_birth: draft.dateOfBirth,
      country: draft.country,
      region: draft.region,
      turnstile_token: captchaToken,
    });

    if (!accepted) return;
    setStatus('submitted');
    setScreen('submitted');
    try {
      window.sessionStorage.removeItem(draftKey(eventSlug));
    } catch {
      // Nothing to clear.
    }
  }

  async function resendEntry() {
    setDialog('none');
    setResendNote(null);
    // The screen never leaves the confirmation view while this is in flight.
    const accepted = await post(`/api/campaigns/${eventSlug}/entries/resend`, {
      email: draft.email.trim(),
      turnstile_token: captchaToken,
    });
    setStatus('submitted');
    if (accepted) setResendNote(submitted.resendDone);
  }

  if (screen === 'submitted') {
    return (
      <section className="space-y-4">
        <h2 className="text-2xl font-bold text-neutral-900">{submitted.heading}</h2>
        <p className="text-[15px] leading-relaxed text-neutral-700">{submitted.body}</p>
        <p className="rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-600">
          {submitted.spam}
        </p>
        {resendNote && <p className="text-sm text-neutral-700">{resendNote}</p>}
        {error && <p className="text-sm font-medium text-[#c8102e]">{error}</p>}

        <div>
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
              {t.captchaFailed}
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={!captchaToken || status === 'sending'}
          onClick={() => setDialog('resend')}
          className="min-h-12 w-full rounded-lg border border-neutral-300 px-5 text-base font-semibold text-neutral-800 disabled:opacity-40"
        >
          {status === 'sending' ? t.submitting : submitted.resend}
        </button>

        <ConfirmationDialog
          open={dialog === 'resend'}
          title={submitted.resendDialogTitle}
          confirmLabel={submitted.resendDialogConfirm}
          cancelLabel={submitted.resendDialogCancel}
          onCancel={() => setDialog('none')}
          onConfirm={resendEntry}
        >
          <p>{submitted.resendDialogBody}</p>
          <p className="font-semibold break-all text-neutral-900">{draft.email.trim()}</p>
          <p>{submitted.resendDialogHint}</p>
        </ConfirmationDialog>
      </section>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) setDialog('send');
      }}
      className="space-y-8"
    >
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">{t.profileHeading}</h2>
          <p className="mt-1 text-sm text-neutral-600">{t.profileNote}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.firstName} id="first-name">
            <input
              id="first-name"
              className={inputClass}
              autoComplete="given-name"
              value={draft.firstName}
              onChange={(event) => set('firstName', event.target.value)}
            />
          </Field>
          <Field label={t.lastName} id="last-name">
            <input
              id="last-name"
              className={inputClass}
              autoComplete="family-name"
              value={draft.lastName}
              onChange={(event) => set('lastName', event.target.value)}
            />
          </Field>
        </div>

        <Field label={t.phone} id="phone">
          <input
            id="phone"
            type="tel"
            className={inputClass}
            autoComplete="tel"
            value={draft.phone}
            onChange={(event) => set('phone', event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.gender} id="gender">
            <select
              id="gender"
              className={inputClass}
              value={draft.gender}
              onChange={(event) => set('gender', event.target.value)}
            >
              <option value="">{t.genderUnset}</option>
              <option value="female">{t.genderFemale}</option>
              <option value="male">{t.genderMale}</option>
              <option value="other">{t.genderOther}</option>
            </select>
          </Field>
          <Field label={t.dateOfBirth} id="date-of-birth">
            <input
              id="date-of-birth"
              type="date"
              className={inputClass}
              autoComplete="bday"
              value={draft.dateOfBirth}
              onChange={(event) => set('dateOfBirth', event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.country} id="country">
            <select
              id="country"
              className={inputClass}
              autoComplete="country"
              value={draft.country}
              onChange={(event) => set('country', event.target.value)}
            >
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.region} id="region">
            <input
              id="region"
              className={inputClass}
              autoComplete="address-level1"
              value={draft.region}
              onChange={(event) => set('region', event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 border-t border-neutral-200 pt-8">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">{t.numberHeading}</h2>
          <p className="mt-1 text-sm text-neutral-600">{t.numberNote}</p>
        </div>

        <Field label={`${t.email} (${t.emailRequired})`} id="email">
          <input
            id="email"
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            className={inputClass}
            value={draft.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </Field>

        <label className="flex items-start gap-3 text-[15px] leading-relaxed text-neutral-800">
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0"
            checked={draft.consent}
            onChange={(event) => set('consent', event.target.checked)}
          />
          <span>
            <ConsentText
              text={t.consent}
              privacyLabel={t.consentPrivacy}
              termsLabel={t.consentTerms}
              termsHref={`/${eventSlug}/terms`}
            />
          </span>
        </label>

        <div>
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
          <p className="mt-2 text-sm text-neutral-600" role="status">
            {captchaFailed ? t.captchaFailed : captchaToken ? '' : t.captchaPending}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-[#c8102e]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSend}
          className="min-h-14 w-full rounded-lg bg-neutral-900 px-6 text-base font-semibold text-white disabled:opacity-40"
        >
          {status === 'sending' ? t.submitting : t.submit}
        </button>
      </section>

      <ConfirmationDialog
        open={dialog === 'send'}
        title={sendDialog.title}
        confirmLabel={sendDialog.confirm}
        cancelLabel={sendDialog.cancel}
        onCancel={() => setDialog('none')}
        onConfirm={submitEntry}
      >
        <p>{sendDialog.body}</p>
        <p className="font-semibold break-all text-neutral-900">{draft.email.trim()}</p>
        <p>{sendDialog.hint}</p>
      </ConfirmationDialog>
    </form>
  );
}

const inputClass =
  'min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base text-neutral-900';

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-neutral-800">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The consent sentence is one localized string with two link targets inside it,
 * so the wording stays in the messages module rather than being assembled out
 * of fragments that only read correctly in English.
 */
function ConsentText({
  text,
  privacyLabel,
  termsLabel,
  termsHref,
}: {
  text: string;
  privacyLabel: string;
  termsLabel: string;
  termsHref: string;
}) {
  const linkClass = 'font-semibold text-neutral-900 underline underline-offset-2';
  const [beforePrivacy, afterPrivacy = ''] = splitOnce(text, privacyLabel);
  const [betweenLinks, afterTerms = ''] = splitOnce(afterPrivacy, termsLabel);

  return (
    <>
      {beforePrivacy}
      <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer" className={linkClass}>
        {privacyLabel}
      </a>
      {betweenLinks}
      <a href={termsHref} className={linkClass}>
        {termsLabel}
      </a>
      {afterTerms}
    </>
  );
}

function splitOnce(value: string, needle: string): [string, string?] {
  const index = value.indexOf(needle);
  if (index === -1) return [value];
  return [value.slice(0, index), value.slice(index + needle.length)];
}

function errorFor(
  code: string | undefined,
  status: number,
  t: ReturnType<typeof messagesFor>['form'],
): string {
  switch (code) {
    case 'captcha_failed':
      return t.captchaFailed;
    case 'try_again_later':
      return t.errorRateLimited;
    case 'registration_unavailable':
      return t.errorClosed;
    case 'invalid_request':
      return t.errorEmail;
    default:
      return status === 429 ? t.errorRateLimited : t.errorGeneric;
  }
}
