import type { Person } from '@shiv/shared';
import { createStore } from '../logic/store-core';
import type { Khata } from '../logic/types';
import { api } from './api';
import { currentUser } from './session';

// Udhaar appears only after an owner has signed off this customer's opening balance. A customer who
// is not signed off gets "not available" from the server and sees nothing at all, not even a word.
export const khataStore = createStore<{ khata: Khata; people: Person[] }>({
  khata: { available: false },
  people: [],
});

export async function refreshKhata() {
  const user = currentUser();
  if (!user) return;
  try {
    const khata = await api<Khata>('/me/khata');
    if (currentUser()?.id !== user.id) return;
    khataStore.patch({ khata });
    if (khata.available) await refreshPeople();
  } catch {
    // Anything unclear shows nothing. A wrong number is worse than no number.
    khataStore.patch({ khata: { available: false } });
  }
}
/** The next page of entries. Read only, like the rest. */
export async function loadMoreKhata() {
  const { khata } = khataStore.get();
  if (!khata.available || !khata.nextCursor) return;
  const next = await api<Khata>(`/me/khata?cursor=${encodeURIComponent(khata.nextCursor)}`);
  if (!next.available) {
    khataStore.patch({ khata: next });
    return;
  }
  khataStore.patch({ khata: { ...next, entries: [...khata.entries, ...next.entries] } });
}
/** The customer's own word about reminders. They may also change their mind. */
export async function setReminders(on: boolean) {
  const { khata } = khataStore.get();
  if (!khata.available) return;
  await api('/me/reminders', 'PUT', { stopped: !on });
  khataStore.patch({ khata: { ...khata, remindersStopped: !on } });
}
export async function refreshPeople() {
  const people = await api<Person[]>('/me/people');
  khataStore.patch({ people });
}
export const forgetKhata = () => khataStore.set({ khata: { available: false }, people: [] });
