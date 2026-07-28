/**
 * Email clients cannot embed a local file; the logo has to be a real URL. It
 * is served from `public/emails/`, so this always resolves to whichever
 * deployment sent the message rather than a hardcoded production address.
 */
export function logoUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return `${base.replace(/\/+$/, '')}/emails/livapon-logo.png`;
}

export const LOGO_ALT = 'LIVAPON';
