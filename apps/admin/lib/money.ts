/** What someone typed in rupees, as whole paise. */
export function rupeesToPaise(value: string, signed = false) {
  const pattern = signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  const typed = value.trim();
  if (!pattern.test(typed)) throw new Error('INVALID_MONEY');
  const negative = typed.startsWith('-');
  const [whole = '', fraction = ''] = typed.replace('-', '').split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise > 2_000_000_000) throw new Error('INVALID_MONEY');
  return negative ? -paise : paise;
}
