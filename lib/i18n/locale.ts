import { DEFAULT_LOCALE, isLocale, type Locale } from './messages';

/**
 * The chosen language is remembered on the device in a cookie rather than in
 * web storage, so the server can render the right language on the first paint.
 * A visitor scanning a QR code at a venue should never see the page flip
 * languages under them.
 */
export const LOCALE_COOKIE = 'livapon_locale';
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function localeFromCookieValue(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function localeCookie(locale: Locale): string {
  return [
    `${LOCALE_COOKIE}=${locale}`,
    'Path=/',
    `Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ].join('; ');
}

/** Writes the device's language choice from the browser. */
export function rememberLocale(locale: Locale): void {
  document.cookie = localeCookie(locale);
}

/** Reads the cookie in the browser without pulling in a cookie library. */
export function readLocaleCookie(cookieHeader: string): Locale {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LOCALE_COOKIE) return localeFromCookieValue(rest.join('='));
  }
  return DEFAULT_LOCALE;
}
