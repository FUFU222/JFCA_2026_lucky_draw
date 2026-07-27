import { createHash, createHmac, randomBytes } from 'node:crypto';

export function createBearerToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function deriveReceiptToken(verificationToken: string, secret: string): string {
  return createHmac('sha256', secret).update(verificationToken).digest('base64url');
}

/**
 * A verification token is reproducible from its opaque database id.  That lets
 * a resend use the same link without ever storing a bearer token in the DB.
 */
export function deriveVerificationToken(tokenId: string, secret: string): string {
  return createHmac('sha256', secret).update(`verification:${tokenId}`).digest('base64url');
}
