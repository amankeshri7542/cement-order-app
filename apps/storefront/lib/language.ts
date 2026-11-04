import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import type { Language } from '../components/language';
import { languageHeader } from './site';

/**
 * The language this request is written in: the address's ?lang= first (search engines index the
 * Hindi pages through it), then the visitor's saved choice, then Hindi for a browser that asks for
 * Hindi first, else English.
 */
export async function requestLanguage(): Promise<{ language: Language; fromAddress: boolean }> {
  const request = await headers();
  const asked = request.get(languageHeader);
  if (asked === 'hi' || asked === 'en') return { language: asked, fromAddress: true };
  const saved = (await cookies()).get('shiv_lang')?.value;
  if (saved === 'hi' || saved === 'en') return { language: saved, fromAddress: false };
  const hindiFirst = /^\s*hi\b/i.test(request.get('accept-language') ?? '');
  return { language: hindiFirst ? 'hi' : 'en', fromAddress: false };
}

/** The English and Hindi addresses of one page, and which of them this rendering is. */
export function languageAlternates(path: string, language: Language) {
  const hindi = `${path}${path.includes('?') ? '&' : '?'}lang=hi`;
  return {
    canonical: language === 'hi' ? hindi : path,
    languages: { en: path, hi: hindi, 'x-default': path },
  };
}

type Copy = { title: string; description: string };
/** Title, description, language alternates and share card for a page, in the request's language. */
export async function pageMetadata(
  path: string,
  copy: { en: Copy; hi: Copy },
  share: { image?: string } = {},
): Promise<Metadata> {
  const { language } = await requestLanguage();
  const text = copy[language];
  const alternates = languageAlternates(path, language);
  return {
    title: text.title,
    description: text.description,
    alternates,
    // A page's openGraph replaces the layout's, so the share card is given in full here.
    openGraph: {
      title: text.title,
      description: text.description,
      url: alternates.canonical,
      siteName: 'Shiv Cement Store',
      type: 'website',
      locale: language === 'hi' ? 'hi_IN' : 'en_IN',
      alternateLocale: [language === 'hi' ? 'en_IN' : 'hi_IN'],
      images: [share.image ?? '/opengraph-image.png'],
    },
    twitter: { card: 'summary_large_image' },
  };
}
