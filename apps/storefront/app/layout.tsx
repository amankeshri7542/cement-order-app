import './base.css';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { SiteFrame } from '../components/site-frame';
import { headScript } from '../film/tier';
import { indexingOn, siteName, siteUrl } from '../lib/site';

// One subset file: Basic Latin, the rupee sign and punctuation, weights 300 to 500. It is under
// 25 KB, served from this site, so no request reaches Google from a visitor's browser.
const hanken = localFont({
  src: './fonts/hanken-grotesk-subset.woff2',
  weight: '300 500',
  style: 'normal',
  display: 'swap',
  variable: '--font-hanken',
  adjustFontFallback: 'Arial',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${siteName}, Patna`,
    template: `%s | ${siteName}`,
  },
  description:
    'Cement, sariya, bricks, balu and gitti from a family shop in Patna, with the rate and the selling unit beside every item.',
  applicationName: siteName,
  openGraph: { siteName, type: 'website', locale: 'en_IN' },
  // Kept out of search results until the owner switches indexing on for the real address.
  robots: indexingOn ? { index: true, follow: true } : { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#eae7de', viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Request-time rendering lets Next attach the per-request CSP nonce to its scripts.
  await connection();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const filmOff = process.env.NEXT_PUBLIC_FILM === 'off';
  return (
    <html lang="en" className={hanken.variable} suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: headScript(filmOff) }}
        />
      </head>
      <body>
        <SiteFrame>{children}</SiteFrame>
      </body>
    </html>
  );
}
