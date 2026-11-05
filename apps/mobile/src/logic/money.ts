// Rupees as a shop writes them: ₹395, ₹1,11,690, and paise only when there are any. Hermes on old
// Androids spaces and pads the currency format, so this does not depend on the phone. Plain logic,
// unit-tested under Node.
export function money(paise: number) {
  const whole = Math.round(Math.abs(paise));
  const rupees = String(Math.floor(whole / 100));
  const part = whole % 100;
  const last = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last}` : last;
  return `${paise < 0 ? '-' : ''}₹${grouped}${part ? `.${String(part).padStart(2, '0')}` : ''}`;
}
