import { connection } from 'next/server';
import { headers } from 'next/headers';
import Script from 'next/script';
import type { Metadata, Viewport } from 'next';
import { Mukta, Inter } from 'next/font/google';
import { color } from '@shiv/design/tokens';
import '@shiv/design/tokens.css';
import './theme.css';
import './owner-base.css';

const display = Mukta({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin', 'devanagari'],
  display: 'swap',
  variable: '--font-mukta',
});
const body = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
export const metadata: Metadata = {
  // Local tooling recognises the desk by this title; the home-screen name comes from the manifest.
  title: 'Shiv Cement · Dukaan ka kaam',
  description: 'Shiv Cement ke order, maal aur hisaab ka kaam.',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'Shiv Cement Desk', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: color.navy };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // Hindi is the desk's default; the language switch updates this on the page.
  return (
    // translate="no": the desk has its own Hindi/English switch, and Chrome's page translation
    // rewrites text React keeps updating (countdowns flicker between languages).
    <html lang="hi" translate="no" className={`${display.variable} ${body.variable}`}>
      <body>
        <Script src="/owner-history.js" strategy="beforeInteractive" nonce={nonce} />
        {children}
      </body>
    </html>
  );
}
