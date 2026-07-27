import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JFCA 2026 Lucky Draw',
  description: 'JFCA 2026 lucky draw registration',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
