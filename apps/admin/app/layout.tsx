import { connection } from 'next/server';
import type { Metadata, Viewport } from 'next';
import { Teko } from 'next/font/google';
import { colors } from '@shiv/shared';
import './theme.css';
import './styles.css';
import './rate-studio.css';

// Self-hosted through next/font, so no request reaches Google from the browser (CSP font-src
// 'self'). Teko 600 sets headings and money figures in Latin and Devanagari.
const display = Teko({
  weight: '600',
  subsets: ['latin', 'devanagari'],
  display: 'swap',
  variable: '--font-teko',
});

export const metadata: Metadata = {
  // Local tooling recognises the desk by this title; the home-screen name comes from the manifest.
  title: 'Shiv Cement Store · Store desk',
  description: 'Orders, quotes, stock and money for Shiv Cement Store.',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'शिव डेस्क', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: colors.ink };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  // Hindi is the desk's default; the language switch updates this on the page.
  return (
    <html lang="hi" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
