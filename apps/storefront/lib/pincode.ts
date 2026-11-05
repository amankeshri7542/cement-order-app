// The last pincode checked on this device. A hint only: the page works without it.
export const PINCODE_KEY = 'shiv_pincode_v1';
export type DeliveryAnswer = {
  serviceable: boolean;
  zone: {
    name: string;
    deliveryFeePaise: number;
    minimumOrderPaise: number;
    freeDeliveryAbovePaise: number | null;
    estimate: string;
    terms: string;
  } | null;
};
export const isPincode = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{5}$/.test(value);
export function readPincode() {
  try {
    const value = localStorage.getItem(PINCODE_KEY);
    return isPincode(value) ? value : '';
  } catch {
    return '';
  }
}
export function savePincode(value: string) {
  try {
    localStorage.setItem(PINCODE_KEY, value);
  } catch {
    /* A hint only. */
  }
}
