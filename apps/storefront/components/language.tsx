'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Language = 'en' | 'hi';
const LanguageContext = createContext({
  language: 'en' as Language,
  setLanguage: (_language: Language) => {},
  t: (english: string, _hindi: string) => english,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');
  useEffect(() => {
    try {
      if (localStorage.getItem('shiv-storefront-language') === 'hi') {
        setLanguage('hi');
        document.documentElement.lang = 'hi';
      }
    } catch {
      /* Browsing works when storage is disabled. */
    }
  }, []);
  function change(next: Language) {
    setLanguage(next);
    document.documentElement.lang = next;
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
