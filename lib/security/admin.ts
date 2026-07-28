export const OPERATOR_DOMAIN = 'chairman.jp';

/**
 * Access is by domain, with no per-person allow list, exactly as the service
 * design asks. The pattern is deliberately strict rather than a suffix check:
 * `person@chairman.jp.example.com` ends with the domain too, and a single
 * `endsWith` would have let it in.
 *
 * ASCII only, so a homoglyph domain cannot match the literal.
 */
const OPERATOR_ADDRESS = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@chairman\.jp$/;

export function normalizeOperatorEmail(email: string | null | undefined): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isChairmanOperator(email: string | null | undefined): boolean {
  return OPERATOR_ADDRESS.test(normalizeOperatorEmail(email));
}
