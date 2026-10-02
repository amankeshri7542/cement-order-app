const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
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
  const response = await fetch(`${base}${path}`, {
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
