'use client';

import { useEffect, useState } from 'react';

import { TurnstileWidget } from './turnstile-widget';
import { ConfirmationDialog } from '../ui/confirmation-dialog';
import { Spinner } from '../ui/spinner';
import { PRIVACY_POLICY_URL } from '../../lib/campaign/legal';
import { DEFAULT_COUNTRY, type CountryOption } from '../../lib/i18n/countries';
import { messages } from '../../lib/i18n/messages';

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
  marketing: boolean;
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
  marketing: false,
};

/** The optional half of the form, the part that starts collapsed. */
const PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'gender',
  'dateOfBirth',
  'country',
  'region',
] as const satisfies ReadonlyArray<keyof Draft>;

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
  turnstileSiteKey: string;
  /**
   * Resolved on the server. Country names come from ICU data, and Node's copy
   * does not always agree with the browser's, so recomputing them here would
   * make the markup differ from what was sent and break hydration.
   */
  countries: readonly CountryOption[];
  /**
   * Set only by the server after re-checking an operator session for `?test=1`
   * (see `app/[eventSlug]/page.tsx`). Marks every request this form makes as
   * test mode; the server re-verifies that claim independently before
   * honoring it, so this prop alone never grants anything.
   */
  isTestMode?: boolean;
}

type Status = 'editing' | 'sending' | 'submitted';
type Screen = 'form' | 'submitted';

export function RaffleForm({
  eventSlug,
  turnstileSiteKey,
  countries,
  isTestMode = false,
}: RaffleFormProps) {
  const t = messages.form;
  const submitted = messages.submitted;
  const sendDialog = messages.sendDialog;

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
  const [profileOpen, setProfileOpen] = useState(false);

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
    const stored = readDraft(eventSlug);
    setDraft(stored);
    setRestored(true);
    // A visitor who already filled these in and then reloaded must not find
    // their own answers hidden behind a collapsed section.
    if (PROFILE_FIELDS.some((field) => stored[field] !== EMPTY_DRAFT[field])) setProfileOpen(true);
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
  // Test mode never renders the widget below, so there is no token to wait on.
  const canSend =
    (isTestMode || Boolean(captchaToken)) && emailLooksUsable && draft.consent && status !== 'sending';

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
      marketing_consent: draft.marketing,
      first_name: draft.firstName,
      last_name: draft.lastName,
      phone: draft.phone,
      gender: draft.gender,
      date_of_birth: draft.dateOfBirth,
      country: draft.country,
      region: draft.region,
      ...(isTestMode ? {} : { turnstile_token: captchaToken }),
      is_test: isTestMode,
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
      ...(isTestMode ? {} : { turnstile_token: captchaToken }),
      is_test: isTestMode,
    });
    setStatus('submitted');
    if (accepted) setResendNote(submitted.resendDone);
  }

  if (screen === 'submitted') {
    return (
      <>
        {isTestMode && <TestModeBanner />}
        <section className="fade-in-up space-y-4">
        <h2 className="text-2xl font-bold text-neutral-900">{submitted.heading}</h2>
        <p className="text-[15px] leading-relaxed text-neutral-700">{submitted.body}</p>
        <p className="rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-600">
          {submitted.spam}
        </p>
        {resendNote && <p className="text-sm text-neutral-700">{resendNote}</p>}
        {error && (
          <p role="alert" className="text-sm font-medium text-[#c8102e]">
            {error}
          </p>
        )}

        {/*
          The captcha lives in the dialog below, not here. It has only ever
          existed to hand a token to this button, and a resend is rare — a
          visitor whose mail went to spam — so a permanently visible challenge
          box sat on the screen everybody sees to serve the few who need it.
          It cannot be dropped altogether: a resend consumes the shared per-IP
          allowance, and at a festival hundreds of visitors are behind one
          address, so an uncaptcha'd resend would let one script exhaust the
          venue's budget and lock all of them out.
        */}
        <button
          type="button"
          // Also disabled while its own dialog is open. The backdrop covers
          // it, but iOS aims the second half of a fast double-tap at the
          // original target — and a second press bumps the round under a
          // mounted widget, which runs a second challenge against the shared
          // budget and can leave the earlier, now-invalid token in state.
          disabled={status === 'sending' || dialog === 'resend'}
          onClick={() => {
            // A fresh challenge every time the dialog opens. A token left over
            // from a cancelled attempt is spendable for a few minutes and then
            // silently is not, which would surface as a failure the visitor
            // did nothing to cause.
            setCaptchaToken(null);
            setCaptchaFailed(false);
            setCaptchaRound((round) => round + 1);
            setDialog('resend');
          }}
          className="min-h-12 w-full rounded-lg border border-neutral-300 px-5 text-base font-semibold text-neutral-800 transition-colors hover:border-neutral-400 disabled:opacity-40"
        >
          <span className="inline-flex items-center justify-center gap-2">
            {status === 'sending' && <Spinner />}
            {status === 'sending' ? t.submitting : submitted.resend}
          </span>
        </button>

        <ConfirmationDialog
          open={dialog === 'resend'}
          title={submitted.resendDialogTitle}
          confirmLabel={submitted.resendDialogConfirm}
          cancelLabel={submitted.resendDialogCancel}
          onCancel={() => setDialog('none')}
          onConfirm={resendEntry}
          tone="brand"
          confirmDisabled={!isTestMode && !captchaToken}
        >
          <p className="font-semibold break-all text-neutral-900">{draft.email.trim()}</p>
          <p>{submitted.resendDialogHint}</p>
          {/* The wrapper scrolls rather than widening the panel: below a
              372px screen even the minimum-width widget does not fit, and a
              challenge that overflows takes the buttons off the screen with
              it. */}
          {!isTestMode && (
            <div>
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
              </div>
              {/* Outside the scroll box, or on a narrow screen the one line
                  explaining what is happening scrolls off with the widget.
                  Always rendered, never conditionally: a live region has to be
                  in the document before its text changes, or the change is not
                  announced at all. */}
              <p className="mt-2 text-sm text-neutral-600" role="status">
                {captchaFailed ? t.captchaFailedInPlace : !captchaToken ? t.captchaPending : ''}
              </p>
            </div>
          )}
        </ConfirmationDialog>
        </section>
      </>
    );
  }

  return (
    <>
      {isTestMode && <TestModeBanner />}
      <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) setDialog('send');
      }}
      className="space-y-8"
    >
      {/*
        Collapsed by default. Almost every visitor arrives by scanning a code at
        a busy booth, and with these seven optional fields expanded the one
        field they actually need sat more than a screen below the fold. The
        section still comes first, so the offer is made before they commit, but
        it costs one line instead of a screenful.
      */}
      <details
        open={profileOpen}
        onToggle={(event) => setProfileOpen(event.currentTarget.open)}
        className="group space-y-4 rounded-xl border border-neutral-200 px-4 py-3 open:pb-5"
      >
        {/*
          The heading is inside the summary rather than beside it: `summary`
          takes either phrasing content or a single heading element, and this
          way the section keeps the heading a screen reader can navigate to,
          exactly as it had before it became collapsible.
        */}
        <summary className="-mx-4 -my-3 cursor-pointer list-none px-4 py-3 text-neutral-700 [&::-webkit-details-marker]:hidden">
          {/*
            No accent dot here, unlike the heading below: that marker is the
            page's one "this is the actual action" signal, and putting it on
            both headings made the optional, collapsed section compete with it
            for attention instead of visibly taking a back seat.
          */}
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            {/* One text flow, so "(Optional)" wraps with the heading instead of
                being pushed against the chevron on a narrow screen. */}
            <span className="min-w-0 flex-1">
              {t.profileHeading}{' '}
              <span className="font-normal text-neutral-500">({t.profileOptional})</span>
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="size-5 shrink-0 text-neutral-500 transition-transform group-open:rotate-180"
            >
              <path
                d="M6 8l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </h2>
        </summary>

        <p className="text-sm text-neutral-600">{t.profileNote}</p>

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
      </details>

      <section className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-neutral-900">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--brand-accent)]" />
            {t.numberHeading}
          </h2>
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

        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed text-neutral-800">
          <input
            type="checkbox"
            className="mt-1 size-6 shrink-0"
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

        {/*
          Separate from the box above, and never a condition of entering. The
          event is in Canada, where consent to commercial email has to be its
          own affirmative act rather than something bundled into the thing the
          visitor actually came for. It is not part of `canSend`.
        */}
        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed text-neutral-800">
          <input
            type="checkbox"
            className="mt-1 size-6 shrink-0"
            checked={draft.marketing}
            onChange={(event) => set('marketing', event.target.checked)}
          />
          <span>{t.marketing}</span>
        </label>

        {!isTestMode && (
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
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-[#c8102e]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSend}
          className="min-h-14 w-full rounded-lg bg-[var(--brand-accent)] px-6 text-base font-semibold text-white transition-colors hover:bg-[var(--brand-accent-hover)] active:bg-[var(--brand-accent-hover)] disabled:bg-neutral-400"
        >
          <span className="inline-flex items-center justify-center gap-2">
            {status === 'sending' && <Spinner />}
            {status === 'sending' ? t.submitting : t.submit}
          </span>
        </button>
      </section>

      <ConfirmationDialog
        open={dialog === 'send'}
        title={sendDialog.title}
        confirmLabel={sendDialog.confirm}
        cancelLabel={sendDialog.cancel}
        onCancel={() => setDialog('none')}
        onConfirm={submitEntry}
        tone="brand"
      >
        <p className="font-semibold break-all text-neutral-900">{draft.email.trim()}</p>
        <p>{sendDialog.hint}</p>
      </ConfirmationDialog>
      </form>
    </>
  );
}

/**
 * Deliberately loud: an operator rehearsing the flow, or anyone who later
 * sees a screenshot of it, must never mistake this for a real entry.
 */
function TestModeBanner() {
  return (
    <div
      role="status"
      className="mb-6 rounded-lg border-2 border-dashed border-[var(--brand-accent)] bg-[var(--brand-tint)] px-4 py-3 text-sm font-semibold text-[var(--brand-accent)]"
    >
      Test mode — this entry will not count toward the draw, and the captcha
      check below is skipped.
    </div>
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

function errorFor(code: string | undefined, status: number, t: typeof messages.form): string {
  switch (code) {
    case 'captcha_failed':
      return t.captchaFailed;
    case 'try_again_later':
      return t.errorRateLimited;
    case 'try_again_later_address':
      return t.errorRateLimitedAddress;
    case 'registration_unavailable':
      return t.errorClosed;
    case 'invalid_request':
      return t.errorEmail;
    case 'test_address_conflict':
      return t.errorTestAddressInUse;
    default:
      return status === 429 ? t.errorRateLimited : t.errorGeneric;
  }
}
