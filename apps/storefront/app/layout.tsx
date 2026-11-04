import type { Metadata } from 'next';
import { Kalam, Teko } from 'next/font/google';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../components/language';
import { requestLanguage } from '../lib/language';
import { Header, Footer } from '../components/shell';
import { CommerceAlert, CommerceProvider, CommerceFeedback } from '../components/commerce';
import { indexingOn, siteName, siteUrl } from '../lib/site';
import './theme.css';
import './globals.css';

// Self-hosted through next/font, so no request reaches Google from the browser (CSP font-src
// 'self'). Teko 600 sets display, headings and prices in Latin and Devanagari; Kalam is the
// shopkeeper's hand on the parchi only, so it is not preloaded on every page.
const display = Teko({
  weight: '600',
  subsets: ['latin', 'devanagari'],
  display: 'swap',
  variable: '--font-teko',
});
const hand = Kalam({
  weight: '400',
  subsets: ['latin', 'devanagari'],
  display: 'swap',
  variable: '--font-kalam',
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${siteName}, Patna | सीमेंट, सरिया, बालू के भाव`,
    template: `%s | ${siteName}`,
  },
  description:
    'Cement, steel, bricks, sand and stone chips at Shiv Cement Store, Patna: current rates with the selling unit beside every price, delivery by pincode, cash on delivery and written bulk quotes. पटना में सीमेंट, सरिया, ईंट, बालू और गिट्टी के भाव।',
  applicationName: siteName,
  openGraph: { siteName, type: 'website', locale: 'en_IN', alternateLocale: ['hi_IN'] },
  // Kept out of search results until the owner switches indexing on for the real address.
  robots: indexingOn ? { index: true, follow: true } : { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Request-time rendering lets Next attach the per-request CSP nonce to its scripts.
  await connection();
  // The first page is written in the visitor's language (lib/language.ts), so a Hindi reader is
  // not shown English until scripts have run.
  const { language, fromAddress } = await requestLanguage();
  return (
    // translate="no": the site has its own Hindi/English switch, and Chrome's page translation
    // rewrites text React keeps updating, which flickers or breaks it.
    <html
      lang={language}
      translate="no"
      data-scroll-behavior="smooth"
      className={`${display.variable} ${hand.variable}`}
    >
      <body>
        <LanguageProvider initial={language} chosen={fromAddress}>
          <CommerceProvider>
            <Header />
            <CommerceAlert />
            <main id="main" className="site-main">
              {children}
            </main>
            <Footer />
            <CommerceFeedback />
          </CommerceProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
