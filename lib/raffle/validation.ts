import { z } from 'zod';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Optional profile inputs arrive from a browser form, which submits an empty
 * string for every field the visitor left alone. Treat those as absent so a
 * blank field is never persisted as `''`, and bound the length so an optional
 * field cannot be used to write unbounded text.
 */
function optionalText(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  );
}

const optionalDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.iso.date().optional(),
);

const emailField = z.string().max(320).transform(normalizeEmail).pipe(z.email());

export const registrationSchema = z
  .object({
    email: emailField,
    terms_consent: z.literal(true),
    first_name: optionalText(100),
    last_name: optionalText(100),
    phone: optionalText(40),
    gender: optionalText(40),
    date_of_birth: optionalDate,
    country: optionalText(100),
    region: optionalText(100),
    locale: z.literal('en'),
  })
  .strict();

export type RegistrationInput = z.infer<typeof registrationSchema>;

/**
 * The service re-validates its own arguments rather than trusting the caller to
 * have parsed the request body, so no side effect can run on unchecked input.
 */
export const verificationRequestSchema = z
  .object({
    eventSlug: z.string().min(1).max(100),
    email: emailField,
    termsConsent: z.literal(true),
    turnstileToken: z.string().min(1).max(4096),
    ipAddress: optionalText(64),
    firstName: optionalText(100),
    lastName: optionalText(100),
    phone: optionalText(40),
    gender: optionalText(40),
    dateOfBirth: optionalDate,
    country: optionalText(100),
    region: optionalText(100),
    // Self-reported, and never trusted on its own — the service re-verifies
    // an operator session server-side before honoring it. See
    // `RaffleService.requestVerification`.
    isTest: z.boolean().optional(),
  })
  .strict();

export type VerificationRequestInput = z.input<typeof verificationRequestSchema>;
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;

export const resendRequestSchema = z
  .object({
    eventSlug: z.string().min(1).max(100),
    email: emailField,
    turnstileToken: z.string().min(1).max(4096),
    ipAddress: optionalText(64),
    isTest: z.boolean().optional(),
  })
  .strict();

export type ResendRequestInput = z.input<typeof resendRequestSchema>;

export const confirmRequestSchema = z
  .object({
    eventSlug: z.string().min(1).max(100),
    // Bearer tokens are 43 base64url characters; the bounds keep an arbitrary
    // string from reaching the hash and the database.
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

export type ConfirmRequestInput = z.input<typeof confirmRequestSchema>;
