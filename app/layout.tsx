import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';

import './globals.css';

export const metadata: Metadata = {
  title: 'JFCA 2026 Lucky Draw',
  description: 'JFCA 2026 lucky draw registration',
};

const heading = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-heading',
  display: 'swap',
});

// Latin only, same as the heading face: the admin panel's Japanese copy falls
// through to the Arial/Helvetica stack in globals.css untouched.
const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
