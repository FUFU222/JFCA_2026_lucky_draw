import { describe, expect, it } from 'vitest';

import { randomUUID } from 'node:crypto';

import {
  createBearerToken,
  deriveReceiptToken,
  deriveVerificationToken,
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

describe('deriveVerificationToken', () => {
  const secret = 'verification-token-secret';

  it('produces a bearer token in the same 256-bit URL-safe form', () => {
    expect(deriveVerificationToken(randomUUID(), secret)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('reproduces the same link for one token id so a resend never changes it', () => {
    const tokenId = randomUUID();

    expect(deriveVerificationToken(tokenId, secret)).toBe(deriveVerificationToken(tokenId, secret));
  });

  it('gives every token id its own link', () => {
    const links = new Set(
      Array.from({ length: 100 }, () => deriveVerificationToken(randomUUID(), secret)),
    );

    expect(links.size).toBe(100);
  });

  it('cannot be computed without the secret, so a leaked token id is not a link', () => {
    const tokenId = randomUUID();

    expect(deriveVerificationToken(tokenId, secret)).not.toBe(
      deriveVerificationToken(tokenId, 'another-secret'),
    );
    expect(deriveVerificationToken(tokenId, secret)).not.toContain(tokenId);
  });

  it('is stored only as a hash, never as the link itself', () => {
    const raw = deriveVerificationToken(randomUUID(), secret);

    expect(hashToken(raw)).not.toBe(raw);
  });
});
