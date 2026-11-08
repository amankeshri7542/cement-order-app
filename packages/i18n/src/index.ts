import en from './en.json';
import hinglish from './hinglish.json';
import hindi from './hi.json';

/**
 * Three languages (plan v4 B2, platform section 6):
 * - 'hinglish': Hindi in Latin letters, the desk's default and the shop's own words;
 * - 'en': English;
 * - 'hi': हिंदी in Devanagari. Pages get their Hindi as they are rebuilt; until a key has it, Hindi
 *   shows the Hinglish words for it, never a blank and never English.
 *
 * Before plan v4, 'hi' meant Hinglish. Stored values were migrated; anything older is read with
 * readLanguage below.
 */
export type Language = 'hinglish' | 'en' | 'hi';
export const languages: readonly Language[] = ['hinglish', 'en', 'hi'];
export type MessageKey = keyof typeof en;
export type Params = Record<string, string | number>;

/** The Hindi catalogue: only the keys translated so far. */
export const hi: Partial<Record<MessageKey, string>> = hindi;
export { en, hinglish };

export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(en, value);
}

export function isLanguage(value: unknown): value is Language {
  return value === 'hinglish' || value === 'en' || value === 'hi';
}

/**
 * A stored or sent language, as it means now. Anything unknown is Hinglish, the desk's default.
 * `legacy` is for values saved before plan v4, when 'hi' meant Hinglish.
 */
export function readLanguage(value: unknown, legacy = false): Language {
  if (legacy && value === 'hi') return 'hinglish';
  return isLanguage(value) ? value : 'hinglish';
}

/** The words for one key in one language. Hindi falls back to Hinglish key by key. */
export function words(key: MessageKey, language: Language = 'hinglish'): string {
  if (language === 'en') return en[key];
  if (language === 'hi') return hi[key] ?? hinglish[key];
  return hinglish[key];
}

export function t(key: MessageKey, params: Params = {}, language: Language = 'hinglish'): string {
  return words(key, language).replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

/** The page's lang attribute: Hinglish is Hindi written in Latin letters. */
export function htmlLang(language: Language) {
  return language === 'en' ? 'en' : language === 'hi' ? 'hi' : 'hi-Latn';
}
