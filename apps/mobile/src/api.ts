import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { User } from '@shiv/shared';
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
let accessToken = '';
let refreshToken = '';
let refreshing: Promise<boolean> | null = null;
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
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      'Cannot reach the store. Check your connection and try again.',
    );
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    if (await refreshing) return api(path, method, body, false);
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error?.code || 'REQUEST_FAILED',
      data.error?.message || 'Could not complete the request.',
      data.error?.details,
    );
  return data as T;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';
