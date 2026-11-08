import { connection } from 'next/server';
import { cookies, headers } from 'next/headers';
import Script from 'next/script';
import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, Noto_Sans_Devanagari } from 'next/font/google';
import { dark, light } from '@shiv/tokens';
import { htmlLang, readLanguage } from '@shiv/i18n';
import '@shiv/design/tokens.css';
import './owner-base.css';

// One family everywhere (DESIGN.md): Hanken Grotesk for Latin, Noto Sans Devanagari for Hindi. The
// Devanagari face is only fetched when Hindi text is on the page.
const sans = Hanken_Grotesk({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken',
});
const devanagari = Noto_Sans_Devanagari({
  weight: ['400', '500', '600'],
  subsets: ['devanagari'],
  display: 'swap',
  variable: '--font-devanagari',
});
export const metadata: Metadata = {
  // Local tooling recognises the desk by this title; the home-screen name comes from the manifest.
  title: 'Shiv Cement · Dukaan ka kaam',
  description: 'Shiv Cement ke order, maal aur hisaab ka kaam.',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'Shiv Cement Desk', statusBarStyle: 'default' },
};
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: light.rail },
    { media: '(prefers-color-scheme: dark)', color: dark.rail },
  ],
};
/** The cookies the desk writes when someone picks a theme or a text size (lib/appearance.ts). */
const themes = ['light', 'dark'] as const;
const sizes = ['large', 'larger'] as const;
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // Theme and text size are set on the page from the start, so it never flashes the wrong one.
  // No cookie means Auto: the device's own light or dark, through tokens.css.
  const jar = await cookies();
  const theme = themes.find((value) => value === jar.get('shiv_theme')?.value);
  const size = sizes.find((value) => value === jar.get('shiv_text')?.value);
  // Hinglish is the desk's default; the language switch updates this on the page.
  const language = readLanguage(jar.get('shiv_lang')?.value);
  return (
    // translate="no": the desk has its own language switch, and Chrome's page translation
    // rewrites text React keeps updating (countdowns flicker between languages).
    <html
      lang={htmlLang(language)}
      translate="no"
      className={`${sans.variable} ${devanagari.variable}`}
      data-theme={theme}
      data-text={size}
    >
      <body>
        <Script src="/owner-history.js" strategy="beforeInteractive" nonce={nonce} />
        {children}
      </body>
    </html>
  );
}
