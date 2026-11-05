import AsyncStorage from '@react-native-async-storage/async-storage';

// Small values this phone keeps between visits: nothing here is a secret (sign-in tokens live in the
// secure store). Written before anything is sent, so a lost reply can always be checked.
export async function readSaved<T>(key: string): Promise<T | null> {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}
export async function writeSaved(key: string, value: unknown) {
  if (value === null) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, JSON.stringify(value));
}
