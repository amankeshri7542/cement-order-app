'use client';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { t, type Language, type MessageKey, type Params } from '@shiv/i18n';

/**
 * The kit's own words (Select all, 1–50 of 1,240, Aaj…) come from the catalogue in the page's
 * language. The desk wraps its pages in KitProvider with the person's language; without one, the kit
 * speaks Hinglish, the desk's default.
 */
const KitLanguage = createContext<Language>('hinglish');

export function KitProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <KitLanguage.Provider value={language}>{children}</KitLanguage.Provider>;
}

export type KitKey = Extract<MessageKey, `kit.${string}`>;
export type KitSay = (key: KitKey, params?: Params) => string;

export function useKitLanguage() {
  return useContext(KitLanguage);
}

export function useKitWords(): KitSay {
  const language = useContext(KitLanguage);
  return useCallback((key, params) => t(key, params ?? {}, language), [language]);
}
