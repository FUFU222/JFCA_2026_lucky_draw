import type { Metadata } from 'next';

import { currentLocale } from '../lib/i18n/server-locale';
import './globals.css';

export const metadata: Metadata = {
  title: 'JFCA 2026 Lucky Draw',
  description: 'JFCA 2026 lucky draw registration',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A Japanese page inside `lang="en"` is read aloud by an English speech
  // synthesizer, and defeats CJK font selection.
  const locale = await currentLocale();

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
