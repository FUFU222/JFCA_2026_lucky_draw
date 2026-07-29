import { describe, expect, it } from 'vitest';

import { UTF8_BOM, entriesToCsv, toCsv } from '../../lib/admin/csv';

describe('toCsv', () => {
  it('starts with a byte order mark so spreadsheets read it as UTF-8', () => {
    expect(toCsv(['a'], [['田中']]).startsWith(UTF8_BOM)).toBe(true);
  });

  it('quotes only what has to be quoted', () => {
    const csv = toCsv(['plain', 'comma', 'quote', 'newline'], [
      ['value', 'a,b', 'say "hi"', 'line1\nline2'],
    ]);

    expect(csv.slice(UTF8_BOM.length)).toBe(
      'plain,comma,quote,newline\r\nvalue,"a,b","say ""hi""","line1\nline2"\r\n',
    );
  });

  it('separates records with CRLF, as the format requires', () => {
    const csv = toCsv(['a'], [['1'], ['2']]).slice(UTF8_BOM.length);

    expect(csv).toBe('a\r\n1\r\n2\r\n');
  });

  it('writes an empty field for a missing value rather than the word null', () => {
    const csv = toCsv(['a', 'b'], [[null, undefined]]).slice(UTF8_BOM.length);

    expect(csv).toBe('a,b\r\n,\r\n');
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    const csv = toCsv(['a'], [['=1+1']]).slice(UTF8_BOM.length);

    expect(csv).toBe("a\r\n'=1+1\r\n");
  });
});

describe('entriesToCsv', () => {
  const entry = {
    number: 10_000,
    email: 'person@example.com',
    state: 'VERIFIED',
    verified_at: '2026-07-28T01:00:00.000Z',
    locale: 'en',
    terms_version: 'jfca-2026-terms-v1-placeholder',
    terms_consented_at: '2026-07-28T00:59:00.000Z',
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone: '+1 416 555 0100',
    gender: 'female',
    date_of_birth: '1990-12-31',
    country: 'CA',
    region: 'Ontario',
    created_at: '2026-07-28T00:59:00.000Z',
  };

  it('carries every field the service design lists', () => {
    const csv = entriesToCsv([entry]).slice(UTF8_BOM.length);
    const [header, row] = csv.split('\r\n');

    expect(header.split(',')).toEqual([
      'number',
      'email',
      'state',
      'verified_at',
      'locale',
      'terms_version',
      'terms_consented_at',
      'marketing_consent',
      'marketing_consent_at',
      'first_name',
      'last_name',
      'phone',
      'gender',
      'date_of_birth',
      'country',
      'region',
      'created_at',
    ]);
    expect(row).toContain('person@example.com');
    expect(row).toContain('10000');
    expect(row).toContain('Ontario');
  });

  it('writes a header even when nothing matched', () => {
    const csv = entriesToCsv([]).slice(UTF8_BOM.length);

    expect(csv).toBe(
      'number,email,state,verified_at,locale,terms_version,terms_consented_at,marketing_consent,marketing_consent_at,first_name,last_name,phone,gender,date_of_birth,country,region,created_at\r\n',
    );
  });

  it('leaves a pending entry without a number', () => {
    const csv = entriesToCsv([{ ...entry, number: null, state: 'PENDING', verified_at: null }])
      .slice(UTF8_BOM.length)
      .split('\r\n')[1];

    expect(csv.startsWith(',person@example.com,PENDING,,')).toBe(true);
  });
});
