export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
type ErrorMessageKey =
  | 'error.network'
  | 'error.timeout'
  | 'error.server'
  | 'error.auth'
  | 'error.forbidden'
  | 'error.invalid';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public messageKey?: ErrorMessageKey,
  ) {
    super(message);
  }
}

function transportError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
  return new ApiError(
    timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    timeout ? 'The store server took too long to respond.' : 'Cannot reach the store server.',
    timeout ? 'error.timeout' : 'error.network',
  );
}

let refreshing: Promise<unknown> | null = null;
async function request(
  path: string,
  init: RequestInit,
  timeout: number,
  retry: boolean,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw transportError(error);
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    refreshing ??= api('/auth/refresh', 'POST', {}, false).finally(() => {
      refreshing = null;
    });
    try {
      await refreshing;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'UNAUTHORIZED' &&
        typeof window !== 'undefined'
      )
        window.dispatchEvent(new Event('owner-session-lost'));
      throw error;
    }
    return request(path, init, timeout, false);
  }
  if (response.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined')
    window.dispatchEvent(new Event('owner-session-lost'));
  return response;
}

function responseError(response: Response, data: unknown): ApiError {
  const detail =
    data && typeof data === 'object' && 'error' in data && typeof data.error === 'object'
      ? (data.error as { code?: unknown; message?: unknown } | null)
      : null;
  const messageKey: ErrorMessageKey =
    response.status >= 500
      ? 'error.server'
      : response.status === 401
        ? 'error.auth'
        : response.status === 403
          ? 'error.forbidden'
          : response.ok
            ? 'error.network'
            : 'error.invalid';
  return new ApiError(
    typeof detail?.code === 'string'
      ? detail.code
      : response.status === 401
        ? 'UNAUTHORIZED'
        : response.status === 403
          ? 'FORBIDDEN'
          : response.ok
            ? 'NETWORK_ERROR'
            : 'REQUEST_FAILED',
    typeof detail?.message === 'string' ? detail.message : 'Could not complete the request.',
    messageKey,
  );
}

async function readJson<T>(response: Response): Promise<T> {
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      throw transportError(error);
    throw responseError(response, null);
  }
  if (!response.ok || data === null) throw responseError(response, data);
  return data as T;
}

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  retry = true,
): Promise<T> {
  const response = await request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    20000,
    retry,
  );
  return readJson<T>(response);
}

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Connection failed. Please try again.';

export async function uploadFile(
  path: string,
  file: File,
  expectedVersion: number,
  retry = true,
): Promise<import('@shiv/shared').RateBatch> {
  const response = await request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-File-Name': encodeURIComponent(file.name),
        'X-Batch-Version': String(expectedVersion),
      },
      body: file,
    },
    60000,
    retry,
  );
  return readJson(response);
}

export async function uploadProductPhoto(file: File, retry = true): Promise<{ publicUrl: string }> {
  if (file.size > 5 * 1024 * 1024)
    throw new ApiError('UPLOAD_TOO_LARGE', 'Choose an image under 5 MiB.', 'error.invalid');
  const response = await request(
    '/admin/uploads',
    { method: 'POST', headers: { 'Content-Type': file.type }, body: file },
    60000,
    retry,
  );
  return readJson(response);
}

/** Downloads the server-built report without changing the authenticated API origin. */
export async function download(path: string, fileName: string, retry = true): Promise<void> {
  const response = await request(path, {}, 30000, retry);
  if (!response.ok) await readJson(response);
  if (response.headers.get('Content-Type')?.includes('text/html'))
    throw responseError(response, null);
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    throw transportError(error);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
