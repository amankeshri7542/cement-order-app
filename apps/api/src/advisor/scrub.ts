import { createHash } from 'node:crypto';
import { plainDigits } from './understand-hindi';

const removed = '[removed]';

/**
 * A question as we keep and send it. Invisible characters go first, so a number or a banned word
 * cannot hide behind them; control characters go with them, and the text is cut to its limit.
 */
export function cleanInput(text: string, limit = 600): string {
  return plainDigits(text.normalize('NFKC'))
    .replace(/[\p{Cf}]/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * Takes out what identifies a person before anything is stored or sent: phone numbers, email, UPI
 * ids, Aadhaar-like and PAN-like strings, GSTINs, and long runs of digits. A six-digit pincode stays
 * for the delivery check. Names cannot be spotted, so the screen asks people not to type them.
 */
export function scrub(text: string): string {
  return (
    text
      // Email and UPI ids share a shape: a name, an @, a handle.
      .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*/gu, removed)
      // GSTIN holds a PAN, so it goes first.
      .replace(/\b\d{2}[A-Za-z]{5}\d{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z]\b/g, removed)
      .replace(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g, removed)
      // Aadhaar: twelve digits, often in fours.
      .replace(/(?<!\d)\d{4}[\s.-]?\d{4}[\s.-]?\d{4}(?!\d)/g, removed)
      // An Indian mobile, with any separators a person might use, and any prefix.
      .replace(/(?<!\d)(?:\+?\s*91[\s.-]*|0[\s.-]*)?[6-9](?:[\s.()-]*\d){9}(?!\d)/g, removed)
      // A landline or anything else that long. A pincode is six digits, and stays.
      .replace(/(?<!\d)\d(?:[\s.-]?\d){7,}(?!\d)/g, removed)
  );
}

/** The question reduced to its words, so the same question asked again finds the same answer. */
export function questionKey(text: string, language: string) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  return createHash('sha256').update(`${language}|${words}`).digest('hex');
}
