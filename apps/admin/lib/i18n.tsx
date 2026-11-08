'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ageLabel,
  errorText,
  momentLabel,
  orderStatusText,
  paymentStatusText,
  quoteStatusText,
  siteLanguage,
} from '@shiv/shared';
import {
  htmlLang,
  isLanguage,
  isMessageKey,
  t as translate,
  type Language,
  type MessageKey,
} from '@shiv/i18n';
import { KitProvider } from '@shiv/design';
import { ApiError, api } from './api';

/**
 * The desk's three languages (plan v4 B2): Hinglish by default, English, or Hindi in Devanagari. The choice is the
 * person's, saved on the server (User.language) so it follows them and the shop's messages to them
 * use it. The `shiv_lang` cookie lets the server draw the next page in it, so it never flashes the
 * wrong language (app/layout.tsx).
 */
type LanguageValue = {
  language: Language;
  /** Shows a language on this page and remembers it in this browser. */
  setLanguage: (language: Language) => void;
};
const LanguageContext = createContext<LanguageValue | null>(null);
export const languageCookie = 'shiv_lang';
/** Before plan v4 the choice lived only in this browser, and 'hi' there meant Hinglish. */
const legacyKey = 'shiv-owner-language';
/** That old choice, kept until it is saved for the person on their next sign-in. */
const carriedKey = 'shiv-language-carried';
const year = 365 * 24 * 60 * 60;

function readCookie(): Language | null {
  const value = document.cookie.match(/(?:^|; )shiv_lang=([a-z]+)/)?.[1];
  return isLanguage(value) ? value : null;
}
function writeCookie(language: Language) {
  document.cookie = `${languageCookie}=${language}; path=/; max-age=${year}; samesite=lax`;
}

export function LanguageProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** The language the server drew the page in, from the cookie. */
  initial?: Language;
}) {
  const [language, setState] = useState<Language>(initial ?? 'hinglish');
  useEffect(() => {
    let next = readCookie();
    try {
      const old = localStorage.getItem(legacyKey);
      if (old !== null) {
        localStorage.removeItem(legacyKey);
        if (!next) {
          next = old === 'en' ? 'en' : 'hinglish';
          writeCookie(next);
          localStorage.setItem(carriedKey, next);
        }
      }
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
    if (next) setState(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = htmlLang(language);
  }, [language]);
  const setLanguage = useCallback((next: Language) => {
    setState(next);
    writeCookie(next);
  }, []);
  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      <KitProvider language={language}>{children}</KitProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('LanguageProvider missing');
  return value;
}

/**
 * The person picks a language: it shows at once and is saved for them. Rejects when saving failed,
 * so the screen can say so; the page keeps the choice either way.
 */
export function useChooseLanguage() {
  const { setLanguage } = useLanguage();
  return useCallback(
    async (next: Language) => {
      setLanguage(next);
      await api('/me/preferences', 'PUT', { language: next });
    },
    [setLanguage],
  );
}

function takeCarried(): Language | null {
  try {
    const value = localStorage.getItem(carriedKey);
    localStorage.removeItem(carriedKey);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Once the session is known, as with the theme: the language this person chose, on any device,
 * wins. Someone who has not chosen one on the server yet keeps this browser's, and an old choice
 * carried over from this browser is saved for them.
 */
export function useSyncLanguage(saved: Language | undefined, signedIn: boolean) {
  const { language, setLanguage } = useLanguage();
  const current = useRef(language);
  current.current = language;
  useEffect(() => {
    if (!signedIn) return;
    const carried = takeCarried();
    if (saved) {
      if (saved !== current.current) setLanguage(saved);
      return;
    }
    if (carried)
      api('/me/preferences', 'PUT', { language: carried }).catch(() => {
        /* Not saved this time; this browser keeps showing it, and Settings can save it later. */
      });
  }, [saved, signedIn, setLanguage]);
}

/** Typed catalogue messages for the desk. Every word on it comes through here. */
export function useT() {
  const { language } = useLanguage();
  return useCallback(
    (key: MessageKey, params?: Parameters<typeof translate>[1]) => translate(key, params, language),
    [language],
  );
}

/** Words the desk shows for statuses, ages and errors, in the chosen language. */
export function useWords() {
  const { language } = useLanguage();
  // Status and error words from @shiv/shared exist in English and Devanagari Hindi only.
  const site = siteLanguage(language);
  return {
    language,
    status: (value: string) => {
      const key = `status.${value}`;
      if (isMessageKey(key)) return translate(key, undefined, language);
      return orderStatusText(value, site) !== value
        ? orderStatusText(value, site)
        : quoteStatusText(value, site) !== value
          ? quoteStatusText(value, site)
          : paymentStatusText(value, site);
    },
    age: (since: string | Date) => ageLabel(since, language),
    moment: (value: string) => momentLabel(value, language),
    error: (e: unknown) => {
      if (e instanceof ApiError) {
        const key = `error.${e.code}`;
        if (isMessageKey(key)) return translate(key, undefined, language);
        if (e.messageKey && e.messageKey !== 'error.invalid')
          return translate(e.messageKey, undefined, language);
        if (language === 'en' && e.message) return e.message;
        if (e.messageKey) return translate(e.messageKey, undefined, language);
        return errorText(e.code, site);
      }
      if (e instanceof Error && e.message && !(e instanceof TypeError)) {
        if (language === 'en') return e.message;
        return translate('error.invalid', undefined, language);
      }
      return translate('error.network', undefined, language);
    },
  };
}
