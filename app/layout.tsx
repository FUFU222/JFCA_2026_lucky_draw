import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JFCA 2026 Lucky Draw',
  description: 'JFCA 2026 lucky draw registration',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // English is the default public language. Task 6 makes this follow the
  // locale the visitor selects.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
