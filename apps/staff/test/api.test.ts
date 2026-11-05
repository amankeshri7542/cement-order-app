import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createApi, isNetworkError, type Tokens } from '../src/logic/api';

type Call = { url: string; init: RequestInit };
function harness(reply: (call: Call, index: number) => Response | Promise<Response>) {
  const state = {
    calls: [] as Call[],
    tokens: { access: 'a1', refresh: 'r1' } as Tokens | null,
    revoked: 0,
    signedOut: 0,
    signed: [] as string[],
  };
  const api = createApi({
    baseUrl: 'http://api.test/api/v1',
    fetch: (async (url: string, init: RequestInit) => {
      const call = { url, init };
      state.calls.push(call);
      return reply(call, state.calls.length - 1);
    }) as typeof fetch,
    getTokens: () => state.tokens,
    setTokens: async (tokens) => {
      state.tokens = tokens;
    },
    sign: async (message) => {
      state.signed.push(message);
      return `signed:${message}`;
    },
    onRevoked: () => {
      state.revoked++;
      state.tokens = null;
    },
    onSignedOut: () => {
      state.signedOut++;
    },
  });
  return { api, state };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refuse = (status: number, code: string) => json(status, { error: { code, message: code } });
const auth = (call: Call) => (call.init.headers as Record<string, string>).Authorization;

test('a request carries the phone’s token, and the answer comes back', async () => {
  const { api, state } = harness(() => json(200, { ok: true }));
  assert.deepEqual(await api.request('GET', 'staff/me/today'), { ok: true });
  assert.equal(auth(state.calls[0]!), 'Bearer a1');
  assert.equal(state.calls[0]!.url, 'http://api.test/api/v1/staff/me/today');
});
test('the server’s code reaches the caller', async () => {
  const { api } = harness(() => refuse(400, 'BAD_QR'));
  await assert.rejects(api.request('POST', 'attendance/punch', {}), (error: ApiError) => {
    assert.equal(error.code, 'BAD_QR');
    assert.equal(error.status, 400);
    return true;
  });
});
test('no reply is told from a refusal', async () => {
  const { api } = harness(() => {
    throw new TypeError('Network request failed');
  });
  await assert.rejects(api.request('GET', 'x'), (error) => isNetworkError(error));
});
test('a reply that is not JSON does not crash anything', async () => {
  const { api } = harness(() => new Response('<html>gateway</html>', { status: 502 }));
  await assert.rejects(api.request('GET', 'x'), (error: ApiError) => {
    assert.equal(error.code, 'HTTP_502');
    return true;
  });
});
test('a Wi-Fi login page answering 200 is not the server saying yes', async () => {
  const { api } = harness(() => new Response('<html>Sign in to Wi-Fi</html>', { status: 200 }));
  await assert.rejects(api.request('POST', 'attendance/punch', {}), (error) =>
    isNetworkError(error),
  );
});
test('an empty success is still a success', async () => {
  const { api } = harness(() => new Response('', { status: 200 }));
  assert.equal(await api.request('POST', 'x', {}), null);
});
test('a request that hangs gives up by itself', async () => {
  const state = { aborted: false };
  const api = createApi({
    baseUrl: 'http://api.test',
    timeoutMs: 10,
    fetch: ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => {
          state.aborted = true;
          reject(new Error('aborted'));
        });
      })) as typeof fetch,
    getTokens: () => null,
    setTokens: async () => {},
    sign: async () => '',
    onRevoked: () => {},
    onSignedOut: () => {},
  });
  await assert.rejects(api.request('GET', 'x'), (error) => isNetworkError(error));
  assert.equal(state.aborted, true);
});

test('DEVICE_REVOKED on any request wipes, at once, and is not retried', async () => {
  const { api, state } = harness(() => refuse(401, 'DEVICE_REVOKED'));
  await assert.rejects(api.request('GET', 'staff/me/today'));
  assert.equal(state.revoked, 1);
  assert.equal(state.calls.length, 1);
  assert.equal(state.tokens, null);
});
test('DEVICE_REVOKED during a renewal wipes too', async () => {
  const { api, state } = harness((call) => {
    if (call.url.endsWith('nonce')) return json(200, { nonce: 'n1' });
    if (call.url.endsWith('renew')) return refuse(401, 'DEVICE_REVOKED');
    return refuse(401, 'UNAUTHORIZED');
  });
  await assert.rejects(api.request('GET', 'staff/me/today'));
  assert.equal(state.revoked, 1);
  assert.equal(state.signedOut, 0);
});
test('an old token renews by signing the nonce, then the request goes again', async () => {
  const { api, state } = harness((call) => {
    if (call.url.endsWith('nonce')) return json(200, { nonce: 'n1' });
    if (call.url.endsWith('renew')) return json(201, { accessToken: 'a2', refreshToken: 'r2' });
    return auth(call) === 'Bearer a2' ? json(200, { ok: 1 }) : refuse(401, 'UNAUTHORIZED');
  });
  assert.deepEqual(await api.request('GET', 'staff/me/today'), { ok: 1 });
  assert.deepEqual(state.signed, ['renew|n1']);
  assert.deepEqual(state.tokens, { access: 'a2', refresh: 'r2' });
  const renewBody = JSON.parse(
    state.calls.find((call) => call.url.endsWith('renew'))!.init.body as string,
  );
  assert.deepEqual(renewBody, { refreshToken: 'r1', nonce: 'n1', signature: 'signed:renew|n1' });
});
test('requests that fail together share one renewal', async () => {
  const { api, state } = harness((call) => {
    if (call.url.endsWith('nonce')) return json(200, { nonce: 'n1' });
    if (call.url.endsWith('renew')) return json(201, { accessToken: 'a2', refreshToken: 'r2' });
    return auth(call) === 'Bearer a2' ? json(200, {}) : refuse(401, 'UNAUTHORIZED');
  });
  await Promise.all([api.request('GET', 'a'), api.request('GET', 'b'), api.request('GET', 'c')]);
  assert.equal(state.calls.filter((call) => call.url.endsWith('renew')).length, 1);
});
test('no signal during a renewal loses nothing, and asks for no new code', async () => {
  const { api, state } = harness((call) => {
    if (call.url.endsWith('nonce')) throw new TypeError('offline');
    return refuse(401, 'UNAUTHORIZED');
  });
  await assert.rejects(api.request('GET', 'x'), (error) => isNetworkError(error));
  assert.equal(state.signedOut, 0);
  assert.equal(state.revoked, 0);
  assert.ok(state.tokens);
});
test('a refused renewal asks for a code, and wipes nothing', async () => {
  const { api, state } = harness((call) => {
    if (call.url.endsWith('nonce')) return json(200, { nonce: 'n1' });
    if (call.url.endsWith('renew')) return refuse(401, 'UNAUTHORIZED');
    return refuse(401, 'UNAUTHORIZED');
  });
  await assert.rejects(api.request('GET', 'x'));
  assert.equal(state.signedOut, 1);
  assert.equal(state.revoked, 0);
});
test('a public request does not carry a token, or renew', async () => {
  const { api, state } = harness(() => refuse(401, 'INVALID_OTP'));
  await assert.rejects(api.request('POST', 'staff-auth/verify', {}, { auth: false }));
  assert.equal(auth(state.calls[0]!), undefined);
  assert.equal(state.calls.length, 1);
});
