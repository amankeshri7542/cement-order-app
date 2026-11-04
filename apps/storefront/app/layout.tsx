import type { Metadata } from 'next';
import { Kalam, Teko } from 'next/font/google';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../components/language';
import { Header, Footer } from '../components/shell';
import { CommerceAlert, CommerceProvider, CommerceFeedback } from '../components/commerce';
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
  title: {
    default: 'Shiv Cement Store | Building materials in Patna',
    template: '%s | Shiv Cement Store',
  },
  description:
    'Browse cement and building materials at Shiv Cement Store, Patna. Compare prices, grades, pack sizes and selling units, and check delivery by pincode.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Request-time rendering lets Next attach the per-request CSP nonce to its scripts.
  await connection();
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${display.variable} ${hand.variable}`}
    >
      <body>
        <LanguageProvider>
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
