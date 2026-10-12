import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { errorText, type Language, type User } from '@shiv/shared';
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
let accessToken = '';
let refreshToken = '';
let refreshing: Promise<boolean> | null = null;
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
  ) {
    super(message);
  }
}
type Session = { user: User; accessToken?: string; refreshToken?: string };
export async function saveSession(session: Session) {
  if (Platform.OS !== 'web' && session.refreshToken && session.accessToken) {
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;
    await SecureStore.setItemAsync('shiv_refresh', refreshToken);
  }
  return session.user;
}
async function refresh() {
  try {
    await saveSession(
      await api<Session>(
        '/auth/refresh',
        'POST',
        Platform.OS === 'web' ? {} : { refreshToken },
        false,
      ),
    );
    return true;
  } catch {
    return false;
  }
}
export async function restoreSession() {
  if (Platform.OS !== 'web') {
    refreshToken = (await SecureStore.getItemAsync('shiv_refresh')) || '';
    if (!refreshToken || !(await refresh())) return null;
  }
  try {
    return (await api<Session>('/auth/session')).user;
  } catch {
    if (Platform.OS === 'web' && (await refresh()))
      return (await api<Session>('/auth/session')).user;
    return null;
  }
}
export async function clearLocalSession() {
  accessToken = '';
  refreshToken = '';
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync('shiv_refresh');
}
export async function logout() {
  await api('/auth/logout', 'POST', Platform.OS === 'web' ? {} : { refreshToken });
  accessToken = '';
  refreshToken = '';
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync('shiv_refresh');
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  retry = true,
): Promise<T> {
  let response: Response;
  // React Native has no AbortSignal.timeout(); calling it throws before any request is sent.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      'Cannot reach the store. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    if (await refreshing) return api(path, method, body, false);
    if (accessToken || Platform.OS === 'web') sessionEnded?.();
  }
  let data: { error?: { code?: string; message?: string; details?: unknown } } & unknown;
  try {
    data = await response.json();
  } catch {
    // A proxy error page, captive Wi-Fi portal or cut-off reply is not the store's JSON.
    throw new ApiError(
      response.ok ? 'NETWORK_ERROR' : 'REQUEST_FAILED',
      'Cannot reach the store. Check your connection and try again.',
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error?.code || 'REQUEST_FAILED',
      data.error?.message || 'Could not complete the request.',
      data.error?.details,
    );
  return data as T;
}
/** Customer-facing text for any failure, in the chosen language. */
export const message = (error: unknown, language: Language = 'en') =>
  error instanceof ApiError
    ? errorText(error.code, language, error.message)
    : error instanceof Error && language === 'en'
      ? error.message
      : errorText('REQUEST_FAILED', language);
