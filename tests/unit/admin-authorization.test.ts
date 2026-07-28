import { describe, expect, it } from 'vitest';

import { OPERATOR_DOMAIN, isChairmanOperator } from '../../lib/security/admin';

describe('isChairmanOperator', () => {
  it('admits the operators the service design names', () => {
    expect(isChairmanOperator('a.tanaka@chairman.jp')).toBe(true);
    expect(isChairmanOperator('info@chairman.jp')).toBe(true);
  });

  it('rejects anyone outside the domain', () => {
    expect(isChairmanOperator('person@example.com')).toBe(false);
    expect(isChairmanOperator('a.tanaka@gmail.com')).toBe(false);
  });

  it('ignores case and surrounding whitespace, because a mail client may add them', () => {
    expect(isChairmanOperator('  A.Tanaka@Chairman.JP  ')).toBe(true);
  });

  it('rejects an address with no local part', () => {
    expect(isChairmanOperator('@chairman.jp')).toBe(false);
    expect(isChairmanOperator('   @chairman.jp')).toBe(false);
  });

  it('rejects domains that merely contain the operator domain', () => {
    for (const address of [
      'person@chairman.jp.example.com',
      'person@notchairman.jp',
      'person@chairman.jpx',
      'person@sub.chairman.jp',
      'person@chairman-jp',
      'person@chairman.jp.',
    ]) {
      expect(isChairmanOperator(address), address).toBe(false);
    }
  });

  it('rejects an address that only looks like the domain', () => {
    // Cyrillic "а" in place of the Latin one.
    expect(isChairmanOperator('person@chаirman.jp')).toBe(false);
  });

  it('rejects a second address smuggled in beside a valid one', () => {
    for (const address of [
      'person@chairman.jp, attacker@example.com',
      'person@example.com,person@chairman.jp',
      'person@chairman.jp attacker@example.com',
      '"person@chairman.jp"@example.com',
    ]) {
      expect(isChairmanOperator(address), address).toBe(false);
    }
  });

  it('rejects anything that is not a usable string', () => {
    for (const value of ['', ' ', 'chairman.jp', 'person', null, undefined]) {
      expect(isChairmanOperator(value as string)).toBe(false);
    }
  });

  it('states the domain it enforces', () => {
    expect(OPERATOR_DOMAIN).toBe('chairman.jp');
  });
});
