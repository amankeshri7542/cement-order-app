import { t, type Language, type MessageKey, type Params } from '@shiv/i18n';

export type { Language };
/** Words for one language. Screens and logic take this, so nothing is ever hard-coded. */
export type Tr = (key: MessageKey, params?: Params) => string;
export const makeTr =
  (language: Language): Tr =>
  (key, params) =>
    t(key, params ?? {}, language);
/** Opens in Hinglish on every install; Simple English is one tap away, in the same place. */
export const firstLanguage: Language = 'hinglish';
