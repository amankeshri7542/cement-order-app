import { createStore } from '../logic/store-core';
import { api } from './api';

// The shop's published numbers. Nothing shows until the family has approved one. The answer is asked
// for again once it is ten minutes old, so a withdrawn number does not stay on a phone.
type ShopAnswer = { contactApproved: boolean; phone: string; whatsapp: string };
export const shopStore = createStore<{ phone: string; whatsapp: string }>({
  phone: '',
  whatsapp: '',
});

const valid = (value: unknown) =>
  typeof value === 'string' && /^\+91[6-9]\d{9}$/.test(value) ? value : '';
const maxAgeMs = 10 * 60 * 1000;
let askedAt = 0;
export async function refreshShop() {
  if (Date.now() - askedAt < maxAgeMs) return;
  askedAt = Date.now();
  try {
    const shop = await api<ShopAnswer>('/public/shop');
    shopStore.set(
      shop.contactApproved
        ? { phone: valid(shop.phone), whatsapp: valid(shop.whatsapp) }
        : { phone: '', whatsapp: '' },
    );
  } catch {
    askedAt = 0;
  }
}
