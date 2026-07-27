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
