import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../components/language';
import { Header, Footer } from '../components/shell';
import { CommerceProvider, CommerceFeedback } from '../components/commerce';
import { AssistantLauncher } from '../components/assistant-launcher';
import './globals.css';

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
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <LanguageProvider>
          <CommerceProvider>
            <Header />
            <main id="main" className="site-main">
              {children}
            </main>
            <Footer />
            <CommerceFeedback />
            <AssistantLauncher />
          </CommerceProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
