import { errorText as sharedErrorText } from '@shiv/shared/src/errors';
import { API_URL } from './api';
/** The ten digits of an Indian mobile number, however it was typed or pasted. */
export function localPhone(value: string) {
  return value
    .replace(/[\s().-]/g, '')
    .replace(/^(?:\+91|0091)(?=\d)/, '')
    .replace(/^91(?=[6-9]\d{9}$)/, '')
    .replace(/^0(?=[6-9])/, '');
}
export class CustomerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    /** For INVALID_INPUT: which fields the store refused, as [{ field, message }]. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}
/** The fields the store refused in a 400 INVALID_INPUT answer. */
export function refusedFields(error: unknown): string[] {
  if (!(error instanceof CustomerError) || !Array.isArray(error.details)) return [];
  return error.details
    .map((item) => (item && typeof item === 'object' ? (item as { field?: unknown }).field : null))
    .filter((field): field is string => typeof field === 'string');
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
      data?.error?.details,
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
export function errorText(error: unknown) {
  return error instanceof CustomerError
    ? sharedErrorText(error.code, 'en', error.message)
    : sharedErrorText(undefined, 'en');
}
