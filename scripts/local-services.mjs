import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const defaults = { api: 4000, admin: 3000, customer: 8081, storefront: 3003 };
export const testPorts = [4010, 3001, 8082, 8092, 3004];

export function localPorts(env = {}, saved = {}) {
  const ports = Object.fromEntries(
    Object.entries(defaults).map(([name, fallback]) => {
      const key = `LOCAL_${name.toUpperCase()}_PORT`;
      const raw = env[key] ?? saved[key] ?? String(fallback);
      if (!/^\d+$/.test(raw) || Number(raw) < 1024 || Number(raw) > 65000)
        throw new Error(`${key} must be an integer port from 1024 to 65000.`);
      return [name, Number(raw)];
    }),
  );
  const all = [...Object.values(ports), ports.customer + 10];
  if (new Set(all).size !== all.length)
    throw new Error(
      'Local ports must be distinct, including the customer Metro port (customer + 10).',
    );
  if (all.some((port) => testPorts.includes(port)))
    throw new Error(`Keep test ports ${testPorts.join(', ')} separate from development.`);
  return ports;
}

export async function assertPortFree(port) {
  for (const host of ['127.0.0.1', '::1']) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', (error) => {
        if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) resolve();
        else
          reject(
            new Error(
              `Port ${port} on ${host} is unavailable (${error.code}). Use local:status and choose an explicit LOCAL_*_PORT; no listener was stopped.`,
            ),
          );
      });
      server.listen({ port, host, ipv6Only: true, exclusive: true }, () => server.close(resolve));
    });
  }
}

function output(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  if (result.error || (result.status !== 0 && result.status !== 1))
    throw new Error(
      `Cannot inspect local process ownership with ${bin}: ${result.error?.message || result.stderr.trim()}`,
    );
  return result.stdout || '';
}

export function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  const line = output('ps', [
    '-p',
    String(pid),
    '-o',
    'lstart=',
    '-o',
    'pgid=',
    '-o',
    'command=',
  ]).trim();
  const match = line.match(/^(.{24})\s+(\d+)\s+(.+)$/);
  if (!match) return null;
  const cwd = output('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
  return { started: match[1].trim(), group: Number(match[2]), command: match[3].trim(), cwd };
}

export function isManaged(record, root, info = processInfo(record?.pid)) {
  if (
    !record ||
    !info ||
    !record.started ||
    info.started !== record.started ||
    info.group !== record.pid ||
    info.cwd !== root
  )
    return false;
  if (record.root) {
    return (
      record.root === root &&
      record.cwd === info.cwd &&
      record.command === info.command &&
      Object.hasOwn(defaults, record.name) &&
      info.command === `${process.execPath} ${root}/scripts/local.mjs serve ${record.name}`
    );
  }
  // Older launcher records are accepted only with this checkout's exact known command and cwd.
  const script = { api: 'api', admin: 'admin', customer: 'web' }[record.name];
  return (
    !!script &&
    info.cwd === root &&
    new RegExp(
      `^npm run dev:${script}(?: -- --port \\d+ --hostname (?:127\\.0\\.0\\.1|localhost))?$`,
    ).test(info.command)
  );
}

export function listenerPids(port) {
  return [
    ...new Set(
      output('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])
        .split('\n')
        .filter((line) => /^p\d+$/.test(line))
        .map((line) => Number(line.slice(1))),
    ),
  ];
}

export function stopManaged(record, root) {
  if (!isManaged(record, root)) return false;
  try {
    process.kill(-record.pid, 'SIGTERM');
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
}

export async function applicationIdentity(name, origin) {
  try {
    const response = await fetch(`${origin}${name === 'api' ? '/api/v1/health' : '/'}`, {
      signal: globalThis.AbortSignal.timeout(5000),
      redirect: 'manual',
    });
    const body = await response.text();
    let matches = false;
    if (response.status === 200) {
      if (name === 'api' && JSON.parse(body).status === 'ok') {
        const docs = await fetch(`${origin}/api/docs-json`, {
          signal: globalThis.AbortSignal.timeout(5000),
        });
        matches = docs.ok && (await docs.json()).info?.title === 'Shiv Cement Store API';
      } else if (name === 'admin')
        matches = /<title>Shiv Cement Store · Store desk<\/title>/.test(body);
      else if (name === 'customer') matches = /<title>Shiv Cement Store<\/title>/.test(body);
      else if (name === 'storefront') matches = response.headers.get('x-shiv-app') === 'storefront';
    }
    return {
      matches,
      description: matches
        ? 'application verified'
        : `wrong application / not ready (HTTP ${response.status})`,
    };
  } catch {
    return { matches: false, description: 'not responding / invalid identity' };
  }
}
