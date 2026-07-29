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
    submit: 'Send confirmation email',
    submitting: 'Sending…',

    captchaPending: 'Checking your browser…',
    captchaFailed: 'That check did not pass. Reload the page and try again.',

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

  sendDialog: {
    title: 'Send the confirmation email?',
    body: 'We will send your confirmation link to:',
    hint: 'Open it within 24 hours to get your number.',
    confirm: 'Send confirmation email',
    cancel: 'Go back',
  },

  submitted: {
    heading: 'Check your email',
    body: 'If this address can enter, a confirmation link is on its way to it.',
    spam: 'No message after a few minutes? Check your spam folder.',
    resend: 'Send it again',
    resendDialogTitle: 'Send the confirmation email again?',
    resendDialogBody: 'We will send the same link to:',
    resendDialogHint: 'You can request it up to three times in 24 hours.',
    resendDialogConfirm: 'Send again',
    resendDialogCancel: 'Go back',
    resendDone: 'If this address can enter, another link is on its way.',
  },

  verify: {
    heading: 'Confirm your email',
    body: 'Confirming issues your Lucky Draw number. It cannot be changed afterwards.',
    action: 'Confirm and get my number',
    dialogTitle: 'Get your Lucky Draw number?',
    dialogBody: 'Your number is issued now and stays yours for this event.',
    dialogConfirm: 'Get my number',
    dialogCancel: 'Go back',
    working: 'Issuing your number…',
    invalidHeading: 'This link cannot be used',
    invalidBody:
      'It may have expired, or it may already have been used. Enter again to get a new link.',
    invalidAction: 'Go to the entry form',
    failed: 'Your number could not be issued. Please try again.',
  },

  receipt: {
    label: 'Your Lucky Draw Number',
    heading: 'Your entry is confirmed',
    screenshot: 'Save this number. A screenshot is the easiest way.',
    venue: 'Results are announced at the venue. Compare them with the number above.',
    emailed: 'We also emailed this number to you.',
    support: 'Lost your number? Contact',
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
