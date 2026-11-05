import en from '@shiv/i18n/src/en.json';

// Every word a customer reads lives in packages/i18n under customer.*, in plain English. The app is
// English only (no language gate and no switching); the catalogue also holds a Hinglish line for
// each, which other surfaces and a later choice can read. Only this English file is bundled.
type AllKeys = keyof typeof en;
type CustomerKey = AllKeys extends infer K
  ? K extends `customer.${infer Rest}`
    ? Rest
    : never
  : never;

export type Word = CustomerKey;
export function w(key: CustomerKey, params?: Record<string, string | number>) {
  const text = (en as Record<string, string>)[`customer.${key}`] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}
