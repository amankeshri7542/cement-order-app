'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'en' | 'hi';
const LanguageContext = createContext({
  language: 'en' as Language,
  setLanguage: (_language: Language) => {},
  t: (english: string, _hindi: string) => english,
});

// The server reads this cookie to render the first page in the visitor's language (and to set
// <html lang>), so a Hindi reader is not shown English until scripts have run.
const cookieName = 'shiv_lang';
function remember(language: Language) {
  try {
    document.cookie = `${cookieName}=${language}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch {
    /* A browser that blocks cookies still shows the page; the choice lasts for the visit. */
  }
}

export function LanguageProvider({
  initial = 'en',
  chosen = false,
  children,
}: {
  initial?: Language;
  /** The address asked for this language (?lang=hi): opening such a link chooses it. */
  chosen?: boolean;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState<Language>(initial);
  useEffect(() => {
    try {
      if (chosen) {
        remember(initial);
        localStorage.setItem('shiv-storefront-language', initial);
        return;
      }
      // A choice saved in this browser wins over what the server guessed.
      const saved = localStorage.getItem('shiv-storefront-language');
      if ((saved === 'hi' || saved === 'en') && saved !== initial) {
        setLanguage(saved);
        document.documentElement.lang = saved;
        remember(saved);
      }
    } catch {
      /* Browsing works when storage is disabled. */
    }
  }, [initial, chosen]);
  function change(next: Language) {
    setLanguage(next);
    document.documentElement.lang = next;
    remember(next);
    // A ?lang= in the address would bring the old language back on reload.
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.delete('lang');
      window.history.replaceState(null, '', url);
    }
    try {
      localStorage.setItem('shiv-storefront-language', next);
    } catch {
      /* Session-only preference. */
    }
  }
  return (
    <LanguageContext
      value={{ language, setLanguage: change, t: (en, hi) => (language === 'hi' ? hi : en) }}
    >
      {children}
    </LanguageContext>
  );
}
export const useLanguage = () => useContext(LanguageContext);
