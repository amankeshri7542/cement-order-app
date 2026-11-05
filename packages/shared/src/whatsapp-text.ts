// The list as a WhatsApp message, the same from every door. Roman script and no prices: the server
// owns prices, and a message can be edited. The first line tells the reader it is shop business, and
// the fixed line shape gives it an easy draft (plans 04 and 07).
export const WHATSAPP_TEXT_LIMIT = 1500;

export type WhatsappLine = { name: string; unit: string; quantity: number };

// Nothing a customer can type should open a different chat or smuggle in markup.
const clean = (text: string) =>
  text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "50 x 50 kg bag UltraTech Super". */
const line = ({ name, unit, quantity }: WhatsappLine) =>
  `${quantity} x ${clean(unit) ? `${clean(unit)} ` : ''}${clean(name)}`;

/** The whole message, cut at a line and never in the middle of a word. */
export function whatsappListText(lines: WhatsappLine[], site?: string) {
  const siteLine = site && clean(site) ? `Site: ${clean(site)}` : '';
  const end = 'aur bhi hai';
  const head = 'Shiv app se list:';
  const room = WHATSAPP_TEXT_LIMIT - (siteLine.length + 1);
  let body = head;
  let cut = false;
  for (const item of lines) {
    const next = `${body}\n${line(item)}`;
    if (next.length + end.length + 1 > room) {
      cut = true;
      break;
    }
    body = next;
  }
  return [body, ...(cut ? [end] : []), ...(siteLine ? [siteLine] : [])].join('\n');
}

/** A wa.me link, or null with no number: the button stays hidden until one is approved. */
export function whatsappListLink(number: string | null | undefined, text: string) {
  const digits = (number ?? '').replace(/\D/g, '');
  if (!/^91[6-9]\d{9}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
