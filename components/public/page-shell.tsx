import Image from 'next/image';
import type { ReactNode } from 'react';

import logo from '../../assets/LIVAPON_logo_horizontal_cropped.png';

/**
 * One column, generous spacing, nothing above the fold but the brand and the
 * task. Almost every visitor arrives by scanning a code on a phone.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 pb-16 pt-6">
      <div aria-hidden="true" className="fixed inset-x-0 top-0 h-1 bg-[var(--brand-accent)]" />
      <header className="mb-8 flex items-center gap-4">
        <Image
          src={logo}
          alt="LIVAPON"
          priority
          className="h-6 w-auto sm:h-7"
          sizes="(max-width: 640px) 140px, 170px"
        />
      </header>
      {children}
    </main>
  );
}
