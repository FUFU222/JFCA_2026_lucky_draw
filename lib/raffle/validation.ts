import { z } from 'zod';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const registrationSchema = z
  .object({
    email: z.string().transform(normalizeEmail).pipe(z.email()),
    terms_consent: z.literal(true),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    gender: z.string().optional(),
    date_of_birth: z.iso.date().optional(),
    country: z.string().optional(),
    region: z.string().optional(),
    locale: z.enum(['en', 'ja']),
  })
  .strict();

export type RegistrationInput = z.infer<typeof registrationSchema>;
