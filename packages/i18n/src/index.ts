import en from './en.json';
import hi from './hi.json';
export { en, hi };
export type Language = 'hi' | 'en';
export type MessageKey = keyof typeof en;
export type Params = Record<string, string | number>;
export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(en, value);
}
export function t(key: MessageKey, params: Params = {}, language: Language = 'hi'): string {
  const message = (language === 'hi' ? hi : en)[key];
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}
