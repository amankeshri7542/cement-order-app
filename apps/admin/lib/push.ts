import { ApiError, api } from './api';

// Phone and computer alerts for the owner desk (web push). The server sends them only to the
// devices an owner switched on here; turning them off removes this device from the list.

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

function keyBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replaceAll('-', '+')
    .replaceAll('_', '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Registers the alert worker; safe to call on every visit. */
export async function registerWorker() {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** Whether this device already receives alerts. */
export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return Boolean(await registration?.pushManager.getSubscription());
}

export async function enablePush() {
  if (!pushSupported())
    throw new ApiError('PUSH_UNSUPPORTED', 'This browser cannot show alerts. Use Chrome on Android.');
  const { publicKey } = await api<{ publicKey: string | null }>('/admin/push/key');
  if (!publicKey)
    throw new ApiError('PUSH_UNAVAILABLE', 'Alerts on this device are not set up on the server yet.');
  if ((await Notification.requestPermission()) !== 'granted')
    throw new ApiError('PUSH_DENIED', 'Alerts are blocked. Allow notifications in the browser settings.');
  await registerWorker();
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  // Only the address and keys: the server's contract rejects extra fields like expirationTime.
  const { endpoint, keys } = subscription.toJSON();
  await api('/admin/push/subscriptions', 'POST', { endpoint, keys });
}

export async function disablePush() {
  const registration = pushSupported() ? await navigator.serviceWorker.getRegistration('/') : null;
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api('/admin/push/subscriptions', 'DELETE', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

let audio: AudioContext | null = null;
/** A short two-tone shop bell for new work while the desk is open. */
export function chime() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const now = audio.currentTime;
    const tones: [number, number][] = [
      [0, 880],
      [0.22, 1320],
    ];
    for (const [offset, pitch] of tones) {
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = pitch;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.5);
      tone.connect(gain).connect(audio.destination);
      tone.start(now + offset);
      tone.stop(now + offset + 0.55);
    }
  } catch {
    /* Sound is a bonus; the badge and list still show new work. */
  }
}

/** The number on the installed desk icon. */
export function setBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  void (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => {});
}
