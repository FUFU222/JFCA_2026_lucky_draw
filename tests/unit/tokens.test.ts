import { describe, expect, it } from 'vitest';

import {
  createBearerToken,
  deriveReceiptToken,
  hashToken,
} from '../../lib/raffle/tokens';

describe('bearer tokens', () => {
  it('creates an unpadded 256-bit base64url token', () => {
    const token = createBearerToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes a token without returning its plaintext', () => {
    const token = 'verification-token';

    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('deriveReceiptToken', () => {
  it('derives the same URL-safe token from identical inputs', () => {
    const verificationToken = 'verification-token';
    const secret = 'receipt-token-secret';

    expect(deriveReceiptToken(verificationToken, secret)).toBe(
      deriveReceiptToken(verificationToken, secret),
    );
    expect(deriveReceiptToken(verificationToken, secret)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('derives different tokens from different verification tokens', () => {
    const secret = 'receipt-token-secret';

    expect(deriveReceiptToken('first-verification-token', secret)).not.toBe(
      deriveReceiptToken('second-verification-token', secret),
    );
  });
});
