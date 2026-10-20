'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  ageLabel,
  errorText,
  momentLabel,
  orderStatusText,
  paymentStatusText,
  quoteStatusText,
} from '@shiv/shared';
import { en, isMessageKey, t as translate, type Language, type MessageKey } from '@shiv/i18n';
import { ApiError } from './api';

// Existing screen errors retain their Hindi wording while catalogue coverage grows.

// The owner desk speaks Hindi by default; the top bar switches every screen to English.
type LanguageValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (en: string, hi: string) => string;
};
const LanguageContext = createContext<LanguageValue | null>(null);
const key = 'shiv-owner-language';
const legacyKeys = new Map(Object.entries(en).map(([key, value]) => [value, key as MessageKey]));

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>('hi');
  useEffect(() => {
    try {
      setState(localStorage.getItem(key) === 'en' ? 'en' : 'hi');
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback((next: Language) => {
    setState(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  const t = useCallback(
    (english: string, hindi: string) => {
      const messageKey = legacyKeys.get(english);
      return messageKey
        ? translate(messageKey, undefined, language)
        : language === 'hi'
          ? hindi
          : english;
    },
    [language],
  );
  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('LanguageProvider missing');
  return value;
}

/** Typed catalogue messages for the owner routes; paired t() remains for existing screens. */
export function useT() {
  const { language } = useLanguage();
  return useCallback(
    (key: MessageKey, params?: Parameters<typeof translate>[1]) => translate(key, params, language),
    [language],
  );
}

/** Words the desk shows for statuses, ages and errors, in the chosen language. */
export function useWords() {
  const { language, t } = useLanguage();
  return {
    t,
    language,
    status: (value: string) => {
      const key = `status.${value}`;
      if (isMessageKey(key)) return translate(key, undefined, language);
      return orderStatusText(value, language) !== value
        ? orderStatusText(value, language)
        : quoteStatusText(value, language) !== value
          ? quoteStatusText(value, language)
          : paymentStatusText(value, language);
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
        return errorText(e.code, language);
      }
      if (e instanceof Error && e.message && !(e instanceof TypeError)) {
        if (language === 'en' || /[\u0900-\u097F]/.test(e.message)) return e.message;
        return translate('error.invalid', undefined, language);
      }
      return translate('error.network', undefined, language);
    },
  };
}
