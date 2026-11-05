// Every WhatsApp link goes through here. Text is Roman script and carries no prices: the server
// owns prices and a message can be edited. Everything is hidden until the number is approved.
export const WHATSAPP_MAX_TEXT = 1500;

export type WaLine = { name: string; unit: string; qty: number };

/** Keeps the message inside what WhatsApp opens safely, cutting whole lines, never a word. */
export function clip(text: string, limit = WHATSAPP_MAX_TEXT) {
  if (text.length <= limit) return text;
  const lines = text.split('\n');
  const end = '...aur bhi hai';
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 + end.length + 1 > limit) break;
    out += `${out ? '\n' : ''}${line}`;
  }
  if (!out) return text.slice(0, limit);
  return `${out}\n${end}`;
}
// Nothing a customer can type should open a different chat or smuggle in markup.
const clean = (text: string) =>
  text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const waText = {
  order: () => 'Namaste, order dena hai.',
  rates: () => 'Namaste, aaj ka rate chahiye.',
  product: (name: string, unit: string) =>
    `Namaste, ${clean(name)} (${clean(unit)}) ka rate aur delivery bata dijiye.`,
  material: (material: string) => `Namaste, ${clean(material)} ke baare mein poochhna hai.`,
  pincode: (pin: string) => `Namaste, pincode ${clean(pin)} par delivery ho sakti hai?`,
  orderNumber: (number: string) => `Order ${clean(number)} ke baare mein`,
  question: (question: string) => `Namaste, mera sawal: ${clean(question)}`,
  list: (lines: WaLine[], pincode?: string) =>
    clip(
      [
        'Namaste, mujhe yeh chahiye:',
        ...lines.map((line) => `${line.qty} x ${clean(line.name)} (${clean(line.unit)})`),
        ...(pincode ? [`Delivery pincode: ${clean(pincode)}`] : []),
      ].join('\n'),
    ),
};

/** A wa.me link. With no number it opens WhatsApp's contact picker, used only in review builds. */
export function waLink(number: string, text?: string) {
  const digits = number.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(clip(text))}` : base;
}
