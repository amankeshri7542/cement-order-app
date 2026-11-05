// Web build, for browser tests only. Android uses expo-secure-store (see secure.native.ts).
const name = (key: string) => `staff:secure:${key}`;
export const getSecret = async (key: string) => localStorage.getItem(name(key));
export const setSecret = async (key: string, value: string) =>
  localStorage.setItem(name(key), value);
export const deleteSecret = async (key: string) => localStorage.removeItem(name(key));
