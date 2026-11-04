import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

type Handler = (event: { data?: unknown; waitUntil: (work: Promise<unknown>) => void }) => void;

/** Runs the real service worker file with a stand-in browser, and delivers one push. */
async function deliver(
  scriptUrl: string,
  payload: unknown,
  fetched: (url: string, init: RequestInit) => Promise<unknown>,
) {
  const handlers: Record<string, Handler> = {};
  const shown: { title: string; options: { body: string } }[] = [];
  const self = {
    location: new URL(scriptUrl),
    addEventListener: (name: string, handler: Handler) => (handlers[name] = handler),
    registration: {
      showNotification: async (title: string, options: { body: string }) => {
        shown.push({ title, options });
      },
    },
    clients: { matchAll: async () => [] },
  };
  vm.runInNewContext(readFileSync(resolve(import.meta.dirname, '../public/sw.js'), 'utf8'), {
    self,
    URL,
    JSON,
    fetch: fetched,
  });
  const work: Promise<unknown>[] = [];
  handlers.push!({ data: { json: () => payload }, waitUntil: (job) => work.push(job) });
  await Promise.all(work);
  return shown;
}
const api = 'https://api.example.test/api/v1';
const worker = `https://desk.example.test/sw.js?api=${encodeURIComponent(api)}`;

test('reports delivery with the alert’s token and no cookies', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const shown = await deliver(
    worker,
    { title: 'Naya order', body: 'SC-1', ack: 'token-123' },
    async (url, init) => {
      calls.push({ url, init });
    },
  );
  assert.equal(shown[0]?.title, 'Naya order');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${api}/admin/push/ack`);
  assert.equal(calls[0]?.init.credentials, 'omit');
  assert.equal(calls[0]?.init.body, JSON.stringify({ token: 'token-123' }));
});

test('a failed report leaves the alert on screen', async () => {
  const shown = await deliver(worker, { ack: 'token-123' }, async () => {
    throw new Error('offline');
  });
  assert.equal(shown.length, 1);
});

test('an alert with no token sends nothing', async () => {
  let calls = 0;
  await deliver(worker, { title: 'Test' }, async () => {
    calls++;
  });
  assert.equal(calls, 0);
});

test('a worker registered without an address sends nothing', async () => {
  let calls = 0;
  await deliver('https://desk.example.test/sw.js', { ack: 'token-123' }, async () => {
    calls++;
  });
  assert.equal(calls, 0);
});

test('an address that is not a web address is refused', async () => {
  let calls = 0;
  await deliver(
    `https://desk.example.test/sw.js?api=${encodeURIComponent('javascript:alert(1)')}`,
    { ack: 'token-123' },
    async () => {
      calls++;
    },
  );
  assert.equal(calls, 0);
});

test('the fallback words carry the new name and are not in Devanagari', async () => {
  const shown = await deliver(worker, {}, async () => undefined);
  assert.equal(shown[0]?.title, 'Shiv Cement Desk');
  assert.doesNotMatch(shown[0]?.options.body ?? '', /[ऀ-ॿ]/);
});

/** Runs the worker, delivers one push, then taps one of its buttons. */
async function tap(
  payload: Record<string, unknown>,
  action: string,
  fetched: (
    url: string,
    init: RequestInit,
  ) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>,
) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    location: new URL(worker),
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      handlers[name] = handler;
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  vm.runInNewContext(readFileSync(resolve(import.meta.dirname, '../public/sw.js'), 'utf8'), {
    self,
    URL,
    JSON,
    fetch: fetched,
  });
  const run = (name: string, event: Record<string, unknown>) => {
    const work: Promise<unknown>[] = [];
    handlers[name]!({ ...event, waitUntil: (job: Promise<unknown>) => work.push(job) });
    return Promise.all(work);
  };
  await run('push', { data: { json: () => payload } });
  const first = shown[0]!;
  await run('notificationclick', {
    action,
    notification: { close() {}, data: first.options.data },
  });
  return { first, shown, opened };
}
const clean = { title: 'Ramesh: 50 bori', body: '₹20,500', url: '/inbox/o1', tag: 'o1', ack: 'a' };

test('a clean card gets the one-tap button, and anything else only Dekho', async () => {
  const withButton = await tap({ ...clean, confirmToken: 'confirm-token' }, 'open', async () => ({
    ok: true,
  }));
  const names = (result: typeof withButton) =>
    Array.from(result.first.options.actions as { action: string }[], (a) => a.action);
  assert.deepEqual(names(withButton), ['confirm', 'open']);
  const without = await tap(clean, 'open', async () => ({ ok: true }));
  assert.deepEqual(names(without), ['open']);
});

test('Pakka karo confirms with no session, then offers Wapas lo', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const { shown, opened } = await tap(
    { ...clean, confirmToken: 'confirm-token' },
    'confirm',
    async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ undoToken: 'undo-token' }) };
    },
  );
  const action = calls.find((call) => call.url.endsWith('/admin/push/action'))!;
  assert.equal(action.init.credentials, 'omit');
  assert.equal(action.init.body, JSON.stringify({ token: 'confirm-token' }));
  assert.equal(opened.length, 0);
  const after = shown[1]!;
  assert.equal(after.title, 'Pakka ho gaya.');
  assert.deepEqual(
    Array.from(after.options.actions as { action: string }[], (a) => a.action),
    ['undo'],
  );
  assert.equal((after.options.data as { undoToken: string }).undoToken, 'undo-token');
});

test('a refused tap opens the card, so the person sees what is true now', async () => {
  const { shown, opened } = await tap(
    { ...clean, confirmToken: 'old-token' },
    'confirm',
    async () => ({
      ok: false,
    }),
  );
  assert.equal(shown.length, 1);
  assert.deepEqual(opened, ['https://desk.example.test/inbox/o1']);
});

test('no network opens the card too, rather than pretending it worked', async () => {
  const { shown, opened } = await tap(
    { ...clean, confirmToken: 'token' },
    'confirm',
    async (url) => {
      if (url.endsWith('/admin/push/ack')) return { ok: true };
      throw new Error('offline');
    },
  );
  assert.equal(shown.length, 1);
  assert.equal(opened.length, 1);
});

test('tapping the body of the alert only opens the card, and confirms nothing', async () => {
  const calls: string[] = [];
  const { opened } = await tap({ ...clean, confirmToken: 'token' }, '', async (url) => {
    calls.push(url);
    return { ok: true };
  });
  assert.equal(opened.length, 1);
  assert.equal(calls.filter((url) => url.endsWith('/admin/push/action')).length, 0);
});
