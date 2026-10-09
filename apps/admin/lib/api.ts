export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
let refreshing: Promise<boolean> | null = null;
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  retry = true,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    refreshing ??= api('/auth/refresh', 'POST', {}, false)
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    if (await refreshing) return api(path, method, body, false);
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error?.code || 'REQUEST_FAILED',
      data.error?.message || 'Could not complete the request.',
    );
  return data as T;
}
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Connection failed. Please try again.';

export async function uploadFile(
  path: string,
  file: File,
  expectedVersion: number,
  retry = true,
): Promise<import('@shiv/shared').RateBatch> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': file.type,
      'X-File-Name': encodeURIComponent(file.name),
      'X-Batch-Version': String(expectedVersion),
    },
    body: file,
    signal: AbortSignal.timeout(60000),
  });
  if (response.status === 401 && retry) {
    await api('/auth/refresh', 'POST', {}, false);
    return uploadFile(path, file, expectedVersion, false);
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error?.code || 'UPLOAD_FAILED',
      data.error?.message || 'Upload failed. Try again.',
    );
  return data;
}

export async function uploadProductPhoto(file: File, retry = true): Promise<{ publicUrl: string }> {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image under 5 MiB.');
  const response = await fetch(`${API_URL}/admin/uploads`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type },
    body: file,
    signal: AbortSignal.timeout(60000),
  });
  if (response.status === 401 && retry) {
    await api('/auth/refresh', 'POST', {}, false);
    return uploadProductPhoto(file, false);
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error?.code || 'ERROR', data.error?.message || 'Image upload failed.');
  return data;
}
