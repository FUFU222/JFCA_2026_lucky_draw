import { describe, expect, it } from 'vitest';

import {
  normalizeEmail,
  registrationSchema,
} from '../../lib/raffle/validation';

describe('normalizeEmail', () => {
  it('trims and lowercases an email at the application boundary', () => {
    expect(normalizeEmail('  PERSON@Example.COM  ')).toBe('person@example.com');
  });
});

describe('registrationSchema', () => {
  const registration = {
    email: '  PERSON@Example.COM  ',
    terms_consent: true,
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone: '+1 555 0100',
    gender: 'female',
    date_of_birth: '1815-12-10',
    country: 'Canada',
    region: 'Ontario',
    locale: 'ja',
  };

  it('accepts a consented registration with the supported optional profile fields', () => {
    const result = registrationSchema.parse(registration);

    expect(result).toMatchObject({
      ...registration,
      email: 'person@example.com',
    });
  });

  it('requires a valid email address', () => {
    expect(registrationSchema.safeParse({ ...registration, email: 'not-an-email' }).success).toBe(
      false,
    );
  });

  it('requires terms consent', () => {
    expect(registrationSchema.safeParse({ ...registration, terms_consent: false }).success).toBe(
      false,
    );
  });

  it('allows only English or Japanese locales', () => {
    expect(registrationSchema.safeParse({ ...registration, locale: 'fr' }).success).toBe(false);
  });

  it('accepts date of birth only as an ISO calendar date', () => {
    expect(
      registrationSchema.safeParse({ ...registration, date_of_birth: '10 December 1815' }).success,
    ).toBe(false);
  });

  it('rejects unknown address fields instead of silently accepting them', () => {
    expect(
      registrationSchema.safeParse({
        ...registration,
        street_address: '1 Main Street',
      }).success,
    ).toBe(false);
  });
});
