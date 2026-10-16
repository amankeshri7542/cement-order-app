import type { Metadata } from 'next';
import { Anek_Latin } from 'next/font/google';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../components/language';
import { Header, Footer } from '../components/shell';
import { CommerceAlert, CommerceProvider, CommerceFeedback } from '../components/commerce';
import './globals.css';

// Self-hosted condensed display face for Latin headings on every device. Devanagari falls back
// to the phone's own Devanagari face: a Devanagari webfont would cost 280–730 KB on mobile data.
const display = Anek_Latin({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-anek',
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
    <html lang="en" data-scroll-behavior="smooth" className={display.variable}>
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
