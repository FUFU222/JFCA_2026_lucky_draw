import { cookies } from 'next/headers';

import { LOCALE_COOKIE, localeFromCookieValue } from './locale';
import type { Locale } from './messages';

/** The language the server should render, taken from the device's cookie. */
export async function currentLocale(): Promise<Locale> {
  const store = await cookies();
  return localeFromCookieValue(store.get(LOCALE_COOKIE)?.value);
}
