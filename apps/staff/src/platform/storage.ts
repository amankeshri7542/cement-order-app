import AsyncStorage from '@react-native-async-storage/async-storage';
import { survivesWipe } from '../logic/wipe';

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const text = await AsyncStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}
export const writeJson = (key: string, value: unknown) =>
  AsyncStorage.setItem(key, JSON.stringify(value));
export const removeItem = (key: string) => AsyncStorage.removeItem(key);
/** Everything held on this phone, except the language and the note that it was cut off. */
export async function clearAllExceptSurvivors() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((key) => !survivesWipe(key)));
}
