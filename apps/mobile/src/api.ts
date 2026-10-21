import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { errorText, type Language, type User } from '@shiv/shared';
import { retryDelays, withRetry } from './retry';
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
let accessToken = '';
let refreshToken = '';
/** 'rejected': the store refused the session for good. 'offline': the store could not be asked. */
export type RefreshResult = 'ok' | 'rejected' | 'offline';
let refreshing: Promise<RefreshResult> | null = null;
// Called when a signed-in request fails because the session ended and could not be renewed.
let sessionEnded: (() => void) | null = null;
export function onSessionEnded(callback: (() => void) | null) {
  sessionEnded = callback;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    /** The store's HTTP status; absent when no reply from the store arrived. */
    public status?: number,
  ) {
    super(message);
  }
}
export const cannotReach = () =>
  new ApiError('NETWORK_ERROR', 'Cannot reach the store. Check your connection and try again.');
/** Only the store answering 401 means a session is over; anything else may be the network. */
const refused = (error: unknown) => error instanceof ApiError && error.status === 401;
type Session = { user: User; accessToken?: string; refreshToken?: string };
export async function saveSession(session: Session) {
  if (Platform.OS !== 'web' && session.refreshToken && session.accessToken) {
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;
    await SecureStore.setItemAsync('shiv_refresh', refreshToken);
  }
  return session.user;
}
async function refresh(): Promise<RefreshResult> {
  const sent = refreshToken;
  if (Platform.OS !== 'web' && !sent) return 'rejected';
  try {
    const renewed = await api<Session>(
      '/auth/refresh',
      'POST',
      Platform.OS === 'web' ? {} : { refreshToken: sent },
      false,
    );
    // Signed out (or signed in again) while this was in flight: keep the newer state. The store
    // ends the renewed session too, because sign-out also matches the rotated-out token.
    if (Platform.OS !== 'web' && refreshToken !== sent) return refreshToken ? 'ok' : 'rejected';
    await saveSession(renewed);
    return 'ok';
  } catch (e) {
    // Weak signal, a timeout, a captive portal or a busy server keep the saved token, so the
    // customer is not sent back to ask for a new SMS code.
    if (!refused(e)) return 'offline';
    // Forget the refused token, unless a new sign-in replaced it meanwhile.
    if (Platform.OS !== 'web' && refreshToken === sent) {
      accessToken = '';
      refreshToken = '';
      await SecureStore.deleteItemAsync('shiv_refresh').catch(() => {});
    }
    return 'rejected';
  }
}
/** One renewal at a time: requests that fail together share it. */
function renew() {
  refreshing ??= refresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
/** The signed-in user, null when signed out, or 'offline' when the store could not be asked. */
export async function restoreSession(): Promise<User | null | 'offline'> {
  if (Platform.OS !== 'web') {
    refreshToken ||= (await SecureStore.getItemAsync('shiv_refresh')) || '';
    if (!refreshToken) return null;
    const result = await renew();
    if (result !== 'ok') return result === 'offline' ? 'offline' : null;
  }
  try {
    return (await api<Session>('/auth/session')).user;
  } catch (e) {
    if (!refused(e)) return 'offline';
    if (Platform.OS !== 'web') return null;
    // The browser's short-lived access cookie may have expired; its refresh cookie renews it.
    const result = await renew();
    if (result === 'ok') return (await api<Session>('/auth/session')).user;
    return result === 'offline' ? 'offline' : null;
  }
}
export async function clearLocalSession() {
  accessToken = '';
  refreshToken = '';
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync('shiv_refresh');
}
export async function logout() {
  // The browser's session lives in HttpOnly cookies that only the store can clear.
  if (Platform.OS === 'web') {
    await api('/auth/logout', 'POST', {});
    return;
  }
  // A phone signs out even with no signal: forget the tokens first, then ask the store to revoke
  // them if it can be reached (an unrevoked session still expires on its own).
  const token = refreshToken;
  await clearLocalSession();
  if (token) void api('/auth/logout', 'POST', { refreshToken: token }).catch(() => {});
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  retry = true,
  timeoutMs = 20000,
): Promise<T> {
  let response: Response;
  // The token this request carries: a late 401 for a token already renewed needs no new renewal.
  const sent = accessToken;
  // React Native has no AbortSignal.timeout(); calling it throws before any request is sent.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      // Only the browser build uses cookies; the phone app sends its token and never a cookie.
      credentials: Platform.OS === 'web' ? 'include' : 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...(sent ? { Authorization: `Bearer ${sent}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } catch {
    throw cannotReach();
  } finally {
    clearTimeout(timer);
  }
  // Any reply, even a refusal, proves the store can be reached, whatever the phone's own check of
  // the connection says (a VPN or a network that blocks Google's check can make it say "offline").
  if (!networkUp) {
    networkUp = true;
    reachedListener?.();
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const signedIn = Boolean(accessToken) || Platform.OS === 'web';
    const result = accessToken && accessToken !== sent ? 'ok' : await renew();
    if (result === 'ok') return api(path, method, body, false);
    // The session may still be good; it just could not be renewed right now.
    if (result === 'offline') throw cannotReach();
    if (signedIn) sessionEnded?.();
  }
  let data: { error?: { code?: string; message?: string; details?: unknown } } & unknown;
  try {
    data = await response.json();
  } catch {
    // A proxy error page, captive Wi-Fi portal or cut-off reply is not the store's JSON.
    throw new ApiError(
      response.ok ? 'NETWORK_ERROR' : 'REQUEST_FAILED',
      'Cannot reach the store. Check your connection and try again.',
      undefined,
      // A gateway's own error page (502, 503, 504) is worth another try; other statuses are not.
      response.status >= 500 ? response.status : undefined,
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error?.code || 'REQUEST_FAILED',
      data.error?.message || 'Could not complete the request.',
      data.error?.details,
      response.status,
    );
  return data as T;
}
let networkUp = true;
/**
 * The phone's connection as NetInfo reports it. With none, a read fails at once (the screen shows
 * what it saved) and is made again when the connection returns, instead of waiting out retries.
 */
export function setNetworkState(up: boolean) {
  networkUp = up;
}
let reachedListener: (() => void) | null = null;
/** Called when the store answers while the phone's own check said there was no connection. */
export function onStoreReached(listener: (() => void) | null) {
  reachedListener = listener;
}
// Browser test builds shorten the waits between tries; a real build never sets this.
const retryScale = Number(process.env.EXPO_PUBLIC_RETRY_SCALE) || 1;
const delays = retryDelays.map((ms) => Math.round(ms * retryScale));
/** A failure on the way to the store (no reply, a cut-off reply, a gateway error), not a refusal. */
const transient = (error: unknown) =>
  error instanceof ApiError &&
  (error.code === 'NETWORK_ERROR' || [502, 503, 504].includes(error.status ?? 0));
/**
 * A read that is tried again after 1, 2 and 4 seconds when the network drops it. Used where a
 * customer is waiting on a list (rates, materials, orders); writes are never retried here.
 */
export const getWithRetry = <T>(path: string) =>
  // Ten seconds a try, so four tries and the waits between them stay under a minute.
  withRetry(() => api<T>(path, 'GET', undefined, true, 10000), {
    retryable: transient,
    delays,
    online: () => networkUp,
  });
/** Customer-facing text for any failure, in the chosen language. */
export const message = (error: unknown, language: Language = 'en') =>
  error instanceof ApiError
    ? errorText(error.code, language, error.message)
    : error instanceof Error && language === 'en'
      ? error.message
      : errorText('REQUEST_FAILED', language);
