import type { Address } from '@shiv/shared';
import { firstRunKeys, isPincode } from '@shiv/shared';
import { createStore } from '../logic/store-core';
import { api } from './api';
import { cacheKeys, readCache, writeCache } from './cache';
import { currentUser } from './session';
import { readSaved, writeSaved } from './saved';

export type Zone = {
  name: string;
  estimate: string;
  terms?: string;
  deliveryFeePaise: number;
  minimumOrderPaise: number;
  freeDeliveryAbovePaise: number | null;
};
export type PincodeAnswer = { serviceable: boolean; area: string; zone: Zone | null };

export const sitesStore = createStore<{
  items: Address[];
  known: boolean;
  /** The last pincode checked on this phone, for a guest. */
  pincode: string;
  answers: Record<string, PincodeAnswer>;
}>({ items: [], known: false, pincode: '', answers: {} });

export async function refreshSites() {
  const user = currentUser();
  if (!user) return;
  const items = await api<Address[]>('/me/addresses');
  if (currentUser()?.id !== user.id) return;
  sitesStore.patch({ items, known: true });
  void writeCache(cacheKeys.sites(user.id), items);
}
/** Sites read from this phone while offline. Adding one needs internet. */
export async function loadSavedSites(userId: string) {
  const saved = await readCache<Address[]>(cacheKeys.sites(userId));
  if (currentUser()?.id === userId && !sitesStore.get().known && Array.isArray(saved?.data))
    sitesStore.patch({ items: saved.data });
}
export const forgetSites = () => sitesStore.patch({ items: [], known: false });

export function putSite(site: Address) {
  sitesStore.set((old) => ({
    ...old,
    items: [site, ...old.items.filter((item) => item.id !== site.id)],
  }));
}
export async function deleteSite(id: string) {
  await api(`/me/addresses/${id}`, 'DELETE');
  sitesStore.set((old) => ({ ...old, items: old.items.filter((item) => item.id !== id) }));
}

/** The shop's answer for one pincode, and what delivery costs there. */
export async function checkPincode(pincode: string) {
  const answer = await api<PincodeAnswer>(`/delivery/${pincode}`);
  sitesStore.set((old) => ({ ...old, answers: { ...old.answers, [pincode]: answer } }));
  return answer;
}
export function rememberPincode(value: string | null) {
  const next = value && isPincode(value) ? value : '';
  sitesStore.patch({ pincode: next });
  void writeSaved(firstRunKeys.pincode, next || null).catch(() => {});
}
export async function loadSavedPincode() {
  const saved = await readSaved<string>(firstRunKeys.pincode);
  if (isPincode(saved)) sitesStore.patch({ pincode: saved });
}
