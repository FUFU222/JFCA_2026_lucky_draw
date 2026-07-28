import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';

import { currentLocale } from '../lib/i18n/server-locale';
import './globals.css';

export const metadata: Metadata = {
  title: 'JFCA 2026 Lucky Draw',
  description: 'JFCA 2026 lucky draw registration',
};

// Latin-only on purpose: Japanese headings must keep falling through to the
// reader's own CJK font (see the `lang` note below), so this only ever
// touches the Latin glyphs — brand, numbers, and English copy.
const heading = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-heading',
  display: 'swap',
});

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A Japanese page inside `lang="en"` is read aloud by an English speech
  // synthesizer, and defeats CJK font selection.
  const locale = await currentLocale();

  return (
    <html lang={locale} className={heading.variable}>
      <body>{children}</body>
    </html>
  );
}
