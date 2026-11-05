import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ApiError, api } from '../state/api';

// Order notifications on the Android phone. Asking is the customer's choice, at a moment they
// understand (right after an order, or from Account); nothing here prompts by itself.

export type PushResult = 'on' | 'denied' | 'offline' | 'unavailable';

/**
 * What this phone remembers about notifications, per account: the permission belongs to the phone
 * but the choice belongs to the person, so the next person to sign in on it is asked afresh and
 * is not registered for notifications they never chose.
 */
export const pushKeys = {
  asked: (userId: string) => `shiv_push_asked:${userId}`,
  on: (userId: string) => `shiv_push_on:${userId}`,
};

/** Asks for permission and sends this phone's token to the store, so order updates reach it. */
export async function enableOrderPush(channelName: string): Promise<PushResult> {
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    await Notifications.setNotificationChannelAsync('orders', {
      name: channelName,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return 'denied';
    const token = await Notifications.getDevicePushTokenAsync();
    await api('/me/devices', 'POST', { token: token.data, platform: 'android' });
    return 'on';
  } catch (error) {
    // No signal is not "not available in this build": the customer can simply try again.
    return error instanceof ApiError && error.code === 'NETWORK_ERROR' ? 'offline' : 'unavailable';
  }
}

/**
 * When this customer chose notifications and the phone still allows them, sends the phone's
 * current token to the store. The token can change over time, so this runs when the customer
 * signs in; it never asks for permission.
 */
export async function refreshPushToken(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') return;
    const token = await Notifications.getDevicePushTokenAsync();
    await api('/me/devices', 'POST', { token: token.data, platform: 'android' });
  } catch {
    // Notifications are optional; every update is also in Orders.
  }
}

/** Clears this app's notifications from the phone's shade (on sign-out, for the next person). */
export async function dismissNotifications() {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    /* Nothing to clear, or notifications are unavailable in this build. */
  }
}

/**
 * What a tap on a notification should open. A tap while the app runs arrives through the listener;
 * a tap that started the app is waiting in the last response. Each is handed over only once.
 */
export function listenForPushTaps(open: (data: unknown) => void): () => void {
  if (Platform.OS === 'web') return () => {};
  try {
    const seen = new Set<string>();
    const handle = (response: Notifications.NotificationResponse | null) => {
      const id = response?.notification.request.identifier;
      if (!response || !id || seen.has(id)) return;
      seen.add(id);
      open(response.notification.request.content.data);
    };
    void Notifications.getLastNotificationResponseAsync()
      .then(handle)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  } catch {
    // Notifications are unavailable in this build; every update is also in Orders.
    return () => {};
  }
}
