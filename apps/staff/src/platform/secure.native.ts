import * as SecureStore from 'expo-secure-store';

export const getSecret = (key: string) => SecureStore.getItemAsync(key);
export const setSecret = (key: string, value: string) => SecureStore.setItemAsync(key, value);
export const deleteSecret = (key: string) => SecureStore.deleteItemAsync(key);
