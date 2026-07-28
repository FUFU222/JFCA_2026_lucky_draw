import Image from 'next/image';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from './locale-switcher';
import logo from '../../assets/LIVAPON_logo_horizontal_cropped.png';
import type { Locale } from '../../lib/i18n/messages';

/**
 * One column, generous spacing, nothing above the fold but the brand and the
 * task. Almost every visitor arrives by scanning a code on a phone.
 */
export function PageShell({
  locale,
  showLocaleSwitcher = true,
  children,
}: {
  locale: Locale;
  showLocaleSwitcher?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 pb-16 pt-6">
      <header className="mb-8 flex items-center justify-between gap-4">
        <Image
          src={logo}
          alt="LIVAPON"
          priority
          className="h-6 w-auto sm:h-7"
          sizes="(max-width: 640px) 140px, 170px"
        />
        {showLocaleSwitcher && <LocaleSwitcher locale={locale} />}
      </header>
      {children}
    </main>
  );
}
