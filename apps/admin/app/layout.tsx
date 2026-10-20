import { connection } from 'next/server';
import { headers } from 'next/headers';
import Script from 'next/script';
import type { Metadata, Viewport } from 'next';
import { Mukta, Inter } from 'next/font/google';
import { color } from '@shiv/design/tokens';
import '@shiv/design/tokens.css';
import './theme.css';
import './styles.css';
import './rate-studio.css';
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
  title: 'शिव सीमेंट स्टोर · दुकान का काम',
  description: 'शिव सीमेंट स्टोर के ऑर्डर, माल और हिसाब का काम।',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'शिव डेस्क', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: color.navy };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // Hindi is the desk's default; the language switch updates this on the page.
  return (
    <html lang="hi" className={`${display.variable} ${body.variable}`}>
      <body>
        <Script src="/owner-history.js" strategy="beforeInteractive" nonce={nonce} />
        {children}
      </body>
    </html>
  );
}
