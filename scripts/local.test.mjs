import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  localPorts,
  assertPortFree,
  processInfo,
  isManaged,
  listenerPids,
  stopManaged,
  applicationIdentity,
} from './local-services.mjs';

async function server(t, handler, host = '127.0.0.1', port = 0) {
  const instance = createServer(handler);
  await new Promise((resolve, reject) => {
    instance.once('error', reject);
    instance.listen({ host, port, ipv6Only: true }, resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        instance.closeAllConnections();
        instance.close(resolve);
      }),
  );
  return instance.address().port;
}

test('explicit ports override saved values; saved values override defaults', () => {
  assert.deepEqual(localPorts(), { api: 4000, admin: 3000, customer: 8081, storefront: 3003 });
  assert.deepEqual(
    localPorts(
      { LOCAL_ADMIN_PORT: '3002', LOCAL_API_PORT: '4100' },
      { LOCAL_ADMIN_PORT: '3100', LOCAL_STOREFRONT_PORT: '3103' },
    ),
    { api: 4100, admin: 3002, customer: 8081, storefront: 3103 },
  );
});

test('invalid, duplicate, Metro and reserved test ports are rejected', () => {
  for (const raw of ['0', '-1', '80', '65001', '3000.5', '3e3', '3000x', ''])
    assert.throws(() => localPorts({ LOCAL_ADMIN_PORT: raw }), /integer port/);
  assert.throws(() => localPorts({ LOCAL_ADMIN_PORT: '4000' }), /distinct/);
  assert.throws(() => localPorts({ LOCAL_ADMIN_PORT: '8091' }), /Metro/);
  for (const port of [4010, 3001, 8082, 8092, 3004])
    assert.throws(() => localPorts({ LOCAL_ADMIN_PORT: String(port) }), /test ports/);
});

test('an IPv4 listener is refused without touching it', async (t) => {
  const port = await server(t, (_req, res) => res.end('unrelated'));
  await assert.rejects(assertPortFree(port), /127\.0\.0\.1.*EADDRINUSE/);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'unrelated');
});

test('an IPv6-only listener is refused even when IPv4 is free', async (t) => {
  let port;
  try {
    port = await server(t, (_req, res) => res.end('IPv6 unrelated'), '::1');
  } catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return t.skip('IPv6 unavailable');
    throw error;
  }
  await assert.rejects(assertPortFree(port), /::1.*EADDRINUSE/);
  assert.equal(await (await fetch(`http://[::1]:${port}`)).text(), 'IPv6 unrelated');
});

test('HTTP 200 does not identify any application', async (t) => {
  const port = await server(t, (_req, res) => res.end('<title>AptoPro</title>'));
  for (const name of ['api', 'admin', 'customer', 'storefront'])
    assert.equal((await applicationIdentity(name, `http://127.0.0.1:${port}`)).matches, false);
});

test('API identity requires both live health and the expected API contract title', async (t) => {
  let title = 'Unrelated API';
  let status = 200;
  const port = await server(t, (req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/v1/health' ? { status: 'ok' } : { info: { title } }));
  });
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await applicationIdentity('api', origin)).matches, false);
  title = 'Shiv Cement Store API';
  assert.equal((await applicationIdentity('api', origin)).matches, true);
  status = 503;
  assert.equal((await applicationIdentity('api', origin)).matches, false);
});

test('frontends must return their expected distinct identity', async (t) => {
  let title = 'Shiv Cement Store · Store desk';
  let marker = '';
  const port = await server(t, (_req, res) => {
    res.setHeader('X-Shiv-App', marker);
    res.end(`<title>${title}</title>`);
  });
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await applicationIdentity('admin', origin)).matches, true);
  assert.equal((await applicationIdentity('customer', origin)).matches, false);
  title = 'Shiv Cement Store';
  assert.equal((await applicationIdentity('customer', origin)).matches, true);
  assert.equal((await applicationIdentity('storefront', origin)).matches, false);
  marker = 'storefront';
  assert.equal((await applicationIdentity('storefront', origin)).matches, true);
});

test('ownership rejects missing timestamps, reused PIDs, other checkouts and commands', () => {
  const root = '/example/project';
  const command = `${process.execPath} ${root}/scripts/local.mjs serve api`;
  const info = { started: 'Fri Oct  9 14:00:33 2026', cwd: root, command, group: 1234 };
  const record = { name: 'api', pid: 1234, root, ...info };
  assert.equal(isManaged(record, root, info), true);
  for (const changed of [
    { started: '' },
    { started: 'later' },
    { cwd: '/elsewhere' },
    { command: 'another app' },
    { group: 5678 },
  ])
    assert.equal(isManaged(record, root, { ...info, ...changed }), false);
  assert.equal(isManaged({ ...record, root: '/elsewhere' }, root, info), false);
  assert.equal(isManaged({ ...record, started: undefined }, root, info), false);
  assert.equal(isManaged(record, root, null), false);
});

test('legacy ownership requires exact known npm commands in this checkout', () => {
  const root = '/example/project';
  const record = { name: 'admin', pid: 1234, started: 'same time' };
  const info = {
    started: record.started,
    cwd: root,
    group: record.pid,
    command: 'npm run dev:admin -- --port 3002 --hostname 127.0.0.1',
  };
  assert.equal(isManaged(record, root, info), true);
  assert.equal(isManaged(record, root, { ...info, cwd: '/another-project' }), false);
  assert.equal(isManaged(record, root, { ...info, command: 'npm run dev:admin-unrelated' }), false);
});

test('managed fixture lifecycle verifies listeners and never signals an unowned process', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shiv-launcher-')));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(
    join(root, 'scripts/local.mjs'),
    `import { createServer } from 'node:http';
    const server = createServer((_req, res) => res.end('fixture'));
    server.listen(0, '127.0.0.1', () => process.send(server.address().port));`,
  );
  const child = spawn(process.execPath, [join(root, 'scripts/local.mjs'), 'serve', 'api'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    rmSync(root, { recursive: true, force: true });
  });
  const [port] = await once(child, 'message');
  const info = processInfo(child.pid);
  assert.ok(info);
  const record = { name: 'api', pid: child.pid, root, ...info };
  assert.equal(isManaged(record, root), true);
  assert.deepEqual(listenerPids(port), [child.pid]);
  assert.equal(stopManaged({ ...record, started: 'reused pid' }, root), false);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'fixture');
  const exit = once(child, 'exit');
  assert.equal(stopManaged(record, root), true);
  await exit;
  assert.equal(processInfo(child.pid), null);
  assert.deepEqual(listenerPids(port), []);
  await assertPortFree(port);
});
