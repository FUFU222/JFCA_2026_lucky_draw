/**
 * Every visitor-facing string lives here so a copy change never means
 * hunting through components.
 */
export const messages = {
  form: {
    profileHeading: 'Tell us a little about yourself',
    // Sits on the collapsed summary, so a visitor can decide whether to open
    // the section without opening it first.
    profileOptional: 'Optional',
    profileNote: 'It helps us tell you about things you might like.',
    firstName: 'First name',
    lastName: 'Last name',
    phone: 'Phone number',
    gender: 'Gender',
    genderUnset: 'Prefer not to say',
    genderFemale: 'Female',
    genderMale: 'Male',
    genderOther: 'Another gender',
    dateOfBirth: 'Date of birth',
    country: 'Country',
    region: 'Province / State / Region',

    numberHeading: 'Get your Lucky Draw number',
    numberNote: 'We email you a link to confirm your address. Your number comes right after.',
    email: 'Email address',
    emailRequired: 'Required',
    consent: 'I agree to the Privacy Policy and the Terms',
    consentPrivacy: 'Privacy Policy',
    consentTerms: 'Terms',
    // A second, optional box. Entering the draw must not be conditional on
    // accepting marketing — the event is in Canada, where consent to
    // commercial email has to be its own affirmative act. Unticked is the
    // default a visitor gets by doing nothing.
    marketing: 'Also send me LIVAPON news and offers by email. You can unsubscribe at any time.',
    marketingOptional: 'Optional — you get your number either way',
    submit: 'Send confirmation email',
    submitting: 'Sending…',

    captchaPending: 'Checking your browser…',
    captchaFailed: 'That check did not pass. Reload the page and try again.',
    // The same failure, told to somebody who must not reload. On the
    // acknowledgement screen the saved draft is already cleared, so a reload
    // lands them on an empty form with no way back to Send it again — and
    // re-entering may be refused by the per-address limit.
    captchaFailedInPlace: 'That check did not pass. Close this and try again.',

    errorEmail: 'Enter an email address you can open right now.',
    errorConsent: 'Please agree to the Privacy Policy and the Terms.',
    errorGeneric: 'Something went wrong. Please try again.',
    errorRateLimited:
      'Too many attempts from this network. Ask a member of staff for help, or try again from mobile data.',
    errorClosed: 'Entries are not open at the moment.',
    // Test mode only, so this one is read by an operator rather than a visitor.
    errorTestAddressInUse:
      'A real entry already uses this address, so it cannot be used for a test run. Try a different address.',
  },

  // The address is the only thing worth reading here, so the title asks the
  // question, the address answers it, and one line covers the deadline. A
  // sentence introducing the address only repeated the title, and a button
  // repeating it a third time was long enough to wrap.
  sendDialog: {
    title: 'Send the confirmation email?',
    hint: 'The link works for 24 hours.',
    confirm: 'Send email',
    cancel: 'Go back',
  },

  submitted: {
    heading: 'Check your email',
    body: 'If this address can enter, a confirmation link is on its way to it.',
    spam: 'No message after a few minutes? Check your spam folder.',
    resend: 'Send it again',
    resendDialogTitle: 'Send the link again?',
    // Keeps the one fact the visitor cannot guess — it is the same link, so an
    // older email in their inbox still works.
    resendDialogHint: 'The same link, up to three times in 24 hours.',
    resendDialogConfirm: 'Send again',
    resendDialogCancel: 'Go back',
    resendDone: 'If this address can enter, another link is on its way.',
    // Followed by a live M:SS countdown; see formatCooldown in raffle-form.tsx.
    resendWait: 'You can request another in',
  },

  // This page has no confirmation dialog, so the one line under the heading is
  // the whole warning — it has to say what pressing the button does and that it
  // happens once. See the note in `VerificationConfirmation` for why a dialog
  // here was removed while the one on the entry form stayed.
  verify: {
    heading: 'Confirm your email',
    body: 'This issues your Lucky Draw number. You get one number, and it stays yours for this event.',
    action: 'Get my number',
    working: 'Issuing your number…',
    invalidHeading: 'This link cannot be used',
    invalidBody:
      'It may have expired, or it may already have been used. Enter again to get a new link.',
    invalidAction: 'Go to the entry form',
    // Shown when the answer never came back — which on a venue network is the
    // likeliest failure there is, and by then the number may already be issued
    // and emailed. "Could not be issued" is a claim this screen is in no
    // position to make, and it talks somebody out of a number they already
    // have. Pressing again is always safe: a repeat confirmation of the same
    // link returns the same number, never a second one.
    failed: 'That did not go through. Tap again — you will not get a second number.',
  },

  // Four lines and a button. This is the screen the whole visit exists to
  // reach, and every extra sentence on it is a sentence between a visitor and
  // the one thing they came for — so the number carries the event name itself,
  // and nothing here explains what the ticket above already shows.
  receipt: {
    label: 'Your Lucky Draw Number',
    heading: 'Your entry is confirmed',
    // The button only exists where the picture could be drawn, so this line has
    // to stand on its own when there is no button beside it.
    save: 'Save your number',
    saveHint: 'Keep it — a screenshot works too.',
    venue: 'Results are announced at the venue. Have your number ready.',
    // Replaces "We also emailed this number to you", which stopped being true
    // when the receipt email went. The confirmation email is the durable copy
    // now: its link returns here for good once a number has been issued.
    lost: 'Lost it? Open the link in your confirmation email again.',
    support: 'Questions:',
  },

  schedule: {
    beforeHeading: 'Entries are not open yet',
    beforeBody: 'Come back when entries open at this event.',
    closedHeading: 'Entries are closed',
    closedBody: 'Thank you for your interest. Results are announced at the venue.',
  },

  terms: { heading: 'Lucky Draw Terms', back: 'Back to the entry form' },
  notFound: { heading: 'Event not found', body: 'Check the address on the QR code.' },
} as const;

export type Messages = typeof messages;
