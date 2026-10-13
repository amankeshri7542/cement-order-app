import { connection } from 'next/server';
import type { Metadata, Viewport } from 'next';
import './styles.css';
import './rate-studio.css';
export const metadata: Metadata = {
  title: 'शिव सीमेंट स्टोर · दुकान डेस्क',
  description: 'Orders, quotes, stock and money for Shiv Cement Store.',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'शिव डेस्क', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#173345' };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  // Hindi is the desk's default; the language switch updates this on the page.
  return (
    <html lang="hi">
      <body>{children}</body>
    </html>
  );
}
