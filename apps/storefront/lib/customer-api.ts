import { errorText as sharedErrorText } from '@shiv/shared';
import { API_URL } from './api';
export class CustomerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
let refreshing: Promise<void> | null = null;
export async function customerApi<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  accountId?: string,
  retry = true,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(accountId ? { 'X-Shiv-Account': accountId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CustomerError(
      'NETWORK_ERROR',
      'The response could not be confirmed. Check your connection and retry.',
    );
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    if (!refreshing)
      refreshing = customerApi('/auth/refresh', 'POST', {}, undefined, false)
        .then(() => {})
        .finally(() => {
          refreshing = null;
        });
    try {
      await refreshing;
    } catch (error) {
      if (error instanceof CustomerError && error.status === 401)
        window.dispatchEvent(new CustomEvent('shiv-session-expired', { detail: { accountId } }));
      throw error;
    }
    return customerApi(path, method, body, accountId, false);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new CustomEvent('shiv-session-expired', { detail: { accountId } }));
    if (data?.error?.code === 'ACCOUNT_CHANGED')
      window.dispatchEvent(new CustomEvent('shiv-session-expired', { detail: { accountId } }));
    throw new CustomerError(
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.message || 'Could not complete the request.',
      response.status,
    );
  }
  if (data === null || typeof data !== 'object')
    throw new CustomerError(
      'NETWORK_ERROR',
      'The response could not be confirmed. Check your connection and retry.',
    );
  return data as T;
}
// Messages come from the catalogue shared with the Android app (@shiv/shared errors.ts).
export function errorText(error: unknown, hi: boolean) {
  return error instanceof CustomerError
    ? sharedErrorText(error.code, hi ? 'hi' : 'en', error.message)
    : sharedErrorText(undefined, hi ? 'hi' : 'en');
}
