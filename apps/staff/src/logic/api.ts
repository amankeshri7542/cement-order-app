import { renewToSign } from './capture';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    /** Absent when no reply came at all. */
    public status?: number,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const isNetworkError = (error: unknown) =>
  error instanceof ApiError && error.status === undefined;

export type Tokens = { access: string; refresh: string };
export type ApiDeps = {
  baseUrl: string;
  fetch: typeof fetch;
  getTokens(): Tokens | null;
  setTokens(tokens: Tokens): Promise<void>;
  sign(message: string): Promise<string>;
  /** The server says this phone is no longer linked. Wipes what it holds. */
  onRevoked(): Promise<void> | void;
  /** The session cannot be renewed: a new code is needed, and nothing else is lost. */
  onSignedOut(): Promise<void> | void;
  timeoutMs?: number;
};

export const requestTimeoutMs = 20000;

export function createApi(deps: ApiDeps) {
  let renewing: Promise<void> | null = null;

  async function raw(
    method: string,
    path: string,
    body: unknown,
    options: {
      auth: boolean;
      token?: string | undefined;
      timeoutMs?: number | undefined;
      headers?: Record<string, string> | undefined;
      rawBody?: unknown;
    },
  ) {
    // No AbortSignal.timeout here: React Native does not have it.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? deps.timeoutMs ?? requestTimeoutMs,
    );
    try {
      const response = await deps.fetch(`${deps.baseUrl}/${path}`, {
        method,
        signal: controller.signal,
        headers: {
          ...(options.rawBody === undefined && body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...(options.auth && options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...options.headers,
        },
        ...(options.rawBody !== undefined
          ? { body: options.rawBody as BodyInit }
          : body !== undefined
            ? { body: JSON.stringify(body) }
            : {}),
      });
      const text = await response.text();
      let parsed: unknown = null;
      let readable = true;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        readable = false;
      }
      // A login page from a Wi-Fi or a proxy answers 200 with HTML. That is not the server saying
      // yes, and treating it as one would throw away a saved scan.
      if (response.ok && !readable) throw new Error('Not the server');
      return { status: response.status, ok: response.ok, body: parsed };
    } catch {
      throw new ApiError('NETWORK', 'No reply');
    } finally {
      clearTimeout(timer);
    }
  }

  const errorFrom = (reply: { status: number; body: unknown }) => {
    const wrapped = reply.body as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    return new ApiError(
      wrapped?.error?.code ?? `HTTP_${reply.status}`,
      wrapped?.error?.message ?? 'Request failed',
      reply.status,
      wrapped?.error?.details,
    );
  };

  /** One renewal at a time: requests that fail together share it. */
  function renew() {
    renewing ??= (async () => {
      const tokens = deps.getTokens();
      if (!tokens) {
        await deps.onSignedOut();
        throw new ApiError('UNAUTHORIZED', 'Signed out', 401);
      }
      const nonce = await raw('GET', 'staff-auth/nonce', undefined, { auth: false });
      if (!nonce.ok) throw errorFrom(nonce);
      const value = (nonce.body as { nonce: string }).nonce;
      const signature = await deps.sign(renewToSign(value));
      const renewed = await raw(
        'POST',
        'staff-auth/renew',
        { refreshToken: tokens.refresh, nonce: value, signature },
        { auth: false },
      );
      if (!renewed.ok) {
        const error = errorFrom(renewed);
        if (error.code === 'DEVICE_REVOKED') await deps.onRevoked();
        else if (renewed.status === 401) await deps.onSignedOut();
        throw error;
      }
      const pair = renewed.body as { accessToken: string; refreshToken: string };
      await deps.setTokens({ access: pair.accessToken, refresh: pair.refreshToken });
    })().finally(() => {
      renewing = null;
    });
    return renewing;
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    options: {
      auth?: boolean;
      timeoutMs?: number;
      headers?: Record<string, string>;
      rawBody?: unknown;
    } = {},
  ): Promise<T> {
    const auth = options.auth !== false;
    const sent = auth ? deps.getTokens()?.access : undefined;
    const first = await raw(method, path, body, { ...options, auth, token: sent });
    if (first.ok) return first.body as T;
    const error = errorFrom(first);
    if (error.code === 'DEVICE_REVOKED') {
      await deps.onRevoked();
      throw error;
    }
    if (!auth || first.status !== 401) throw error;
    // Renewed by someone else while this was on its way: a retry needs no new renewal.
    if (deps.getTokens()?.access === sent) await renew();
    const retried = await raw(method, path, body, {
      ...options,
      auth,
      token: deps.getTokens()?.access,
    });
    if (retried.ok) return retried.body as T;
    const second = errorFrom(retried);
    if (second.code === 'DEVICE_REVOKED') await deps.onRevoked();
    else if (retried.status === 401) await deps.onSignedOut();
    throw second;
  }
  return { request, renew };
}
export type Api = ReturnType<typeof createApi>;
