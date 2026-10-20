import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { API_URL, ApiError, api, download, uploadFile, uploadProductPhoto } from './api';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const mockFetch = (t: TestContext, handler: typeof fetch) =>
  t.mock.method(globalThis, 'fetch', handler);
const failsWith = (key: NonNullable<ApiError['messageKey']>, code?: string) => (error: unknown) =>
  error instanceof ApiError && error.messageKey === key && (!code || error.code === code);

test('JSON requests retain the API origin, cookies, body and timeout signal', async (t) => {
  mockFetch(t, async (input, init) => {
    assert.equal(input, `${API_URL}/admin/orders`);
    assert.equal(init?.credentials, 'include');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
    assert.equal(init?.body, JSON.stringify({ customerId: 'customer' }));
    assert.ok(init?.signal instanceof AbortSignal);
    return json({ id: 'order' });
  });
  assert.deepEqual(await api('/admin/orders', 'POST', { customerId: 'customer' }), { id: 'order' });
});

test('JSON 5xx responses keep the diagnostic code and use the server message key', async (t) => {
  mockFetch(t, async () =>
    json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Diagnostic' } }, 500),
  );
  await assert.rejects(api('/admin/orders'), failsWith('error.server', 'DATABASE_UNAVAILABLE'));
});

test('a proxy HTML 502 response is a server failure', async (t) => {
  mockFetch(t, async () => new Response('<html>upstream unavailable</html>', { status: 502 }));
  await assert.rejects(api('/admin/orders'), failsWith('error.server'));
});

test('truncated JSON with a successful status is a network failure', async (t) => {
  mockFetch(t, async () => new Response('{"id":'));
  await assert.rejects(api('/admin/orders'), failsWith('error.network', 'NETWORK_ERROR'));
});

test('fetch rejection is a network failure', async (t) => {
  mockFetch(t, async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(api('/admin/orders'), failsWith('error.network', 'NETWORK_ERROR'));
});

test('a fetch timeout is distinguishable from an offline failure', async (t) => {
  mockFetch(t, async () => {
    throw new DOMException('request timed out', 'TimeoutError');
  });
  await assert.rejects(api('/admin/orders'), failsWith('error.timeout', 'TIMEOUT'));
});

test('a timeout while reading JSON retains its timeout classification', async (t) => {
  const response = json({});
  t.mock.method(response, 'json', async () => {
    throw new DOMException('body timed out', 'AbortError');
  });
  mockFetch(t, async () => response);
  await assert.rejects(api('/admin/orders'), failsWith('error.timeout', 'TIMEOUT'));
});

test('an expired refresh session is an auth failure without a refresh loop', async (t) => {
  const paths: string[] = [];
  mockFetch(t, async (input) => {
    paths.push(String(input));
    return json({}, 401);
  });
  await assert.rejects(api('/admin/orders'), failsWith('error.auth', 'UNAUTHORIZED'));
  assert.deepEqual(paths, [`${API_URL}/admin/orders`, `${API_URL}/auth/refresh`]);
});

test('forbidden responses retain a distinct classification', async (t) => {
  mockFetch(t, async () => json({}, 403));
  await assert.rejects(api('/admin/orders'), failsWith('error.forbidden', 'FORBIDDEN'));
});

test('invalid requests retain domain error codes for localized validation', async (t) => {
  mockFetch(t, async () =>
    json({ error: { code: 'CREDIT_LIMIT_EXCEEDED', message: 'Limit exceeded' } }, 400),
  );
  await assert.rejects(api('/admin/orders'), failsWith('error.invalid', 'CREDIT_LIMIT_EXCEEDED'));
});

test('concurrent JSON and binary writes share one refresh and replay their bodies once', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const attempts = new Map<string, number>();
  const file = new File(['rates'], 'rates.png', { type: 'image/png' });
  let refreshes = 0;
  mockFetch(t, async (input, init) => {
    const path = String(input).slice(API_URL.length);
    assert.equal(init?.credentials, 'include');
    if (path === '/auth/refresh') {
      refreshes++;
      await gate;
      return json({ refreshed: true });
    }
    assert.equal(init?.body, path === '/admin/orders' ? '{"quantity":2}' : file);
    const attempt = (attempts.get(path) || 0) + 1;
    attempts.set(path, attempt);
    return attempt === 1 ? json({}, 401) : json({ path });
  });
  const orders = api('/admin/orders', 'POST', { quantity: 2 });
  const upload = uploadFile('/admin/rates', file, 4);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 1);
  release();
  assert.deepEqual(await Promise.all([orders, upload]), [
    { path: '/admin/orders' },
    { path: '/admin/rates' },
  ]);
  assert.deepEqual(
    [...attempts],
    [
      ['/admin/orders', 2],
      ['/admin/rates', 2],
    ],
  );
});

test('an outage during refresh remains a network failure', async (t) => {
  mockFetch(t, async (input) => {
    if (String(input).endsWith('/auth/refresh')) throw new TypeError('offline');
    return json({}, 401);
  });
  await assert.rejects(api('/admin/orders'), failsWith('error.network', 'NETWORK_ERROR'));
});

test('batch uploads retain binary data and version headers', async (t) => {
  const file = new File(['rates'], 'October rates.png', { type: 'image/png' });
  mockFetch(t, async (input, init) => {
    assert.equal(input, `${API_URL}/admin/rates`);
    assert.equal(init?.body, file);
    assert.equal(init?.credentials, 'include');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Content-Type'), 'image/png');
    assert.equal(headers.get('X-File-Name'), 'October%20rates.png');
    assert.equal(headers.get('X-Batch-Version'), '7');
    return json({ id: 'batch' });
  });
  assert.deepEqual(await uploadFile('/admin/rates', file, 7), { id: 'batch' });
});

test('malformed batch upload errors use the server classification', async (t) => {
  mockFetch(t, async () => new Response('upstream unavailable', { status: 503 }));
  await assert.rejects(
    uploadFile('/admin/rates', new File(['x'], 'rates.png'), 1),
    failsWith('error.server'),
  );
});

test('product image upload timeouts use the timeout message key', async (t) => {
  mockFetch(t, async () => {
    throw new DOMException('timed out', 'TimeoutError');
  });
  await assert.rejects(
    uploadProductPhoto(new File(['x'], 'photo.png')),
    failsWith('error.timeout'),
  );
});

test('oversized photos are rejected before making a request', async (t) => {
  const fetch = mockFetch(t, async () => {
    throw new Error('must not make a request');
  });
  const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png');
  await assert.rejects(uploadProductPhoto(file), failsWith('error.invalid', 'UPLOAD_TOO_LARGE'));
  assert.equal(fetch.mock.callCount(), 0);
});

test('CSV error responses are classified without accessing the DOM', async (t) => {
  mockFetch(t, async () => new Response('<html>unavailable</html>', { status: 502 }));
  await assert.rejects(download('/admin/reports/export', 'report.csv'), failsWith('error.server'));
});

test('a successful HTML proxy page cannot be downloaded as a CSV', async (t) => {
  mockFetch(
    t,
    async () => new Response('<html>proxy</html>', { headers: { 'Content-Type': 'text/html' } }),
  );
  await assert.rejects(download('/admin/reports/export', 'report.csv'), failsWith('error.network'));
});

test('CSV downloads preserve contents, filename and cookies, then release their blob URL', async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  let clicked = false;
  let removed = false;
  let appended = false;
  const link = {
    href: '',
    download: '',
    click: () => {
      clicked = true;
    },
    remove: () => {
      removed = true;
    },
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => link,
      body: {
        append: () => {
          appended = true;
        },
      },
    },
  });
  let downloaded: Blob | undefined;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
    downloaded = blob;
    return 'blob:test-report';
  });
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void) => {
    callback();
    return 0;
  }) as unknown as typeof setTimeout);
  mockFetch(t, async (input, init) => {
    assert.equal(input, `${API_URL}/admin/reports/export?from=2026-10-20&to=2026-10-20`);
    assert.equal(init?.credentials, 'include');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response('customer,total\nRamesh,200', { headers: { 'Content-Type': 'text/csv' } });
  });
  await download('/admin/reports/export?from=2026-10-20&to=2026-10-20', 'October.csv');
  assert.equal(await downloaded?.text(), 'customer,total\nRamesh,200');
  assert.equal(link.href, 'blob:test-report');
  assert.equal(link.download, 'October.csv');
  assert.ok(clicked && removed && appended);
  assert.equal(revoke.mock.calls[0]!.arguments[0], 'blob:test-report');
});
