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

// The desk's root only redirects to /today, so its identity is read from the page itself.
const identityPaths = { api: '/api/v1/health', admin: '/today' };

export async function applicationIdentity(name, origin) {
  try {
    const response = await fetch(`${origin}${identityPaths[name] ?? '/'}`, {
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
        matches =
          /<title>(?:Shiv Cement · Dukaan ka kaam|Shiv Cement Store · Store desk|शिव सीमेंट स्टोर · दुकान का काम)<\/title>/.test(
            body,
          );
      else if (name === 'customer') matches = /<title>Shiv Cement(?: Store)?<\/title>/.test(body);
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

// On macOS, PostgreSQL refuses to start ("postmaster became multithreaded during startup")
// when the shell has no locale, e.g. a fresh terminal or app session. Supply one if missing.
export function pgEnv(env = process.env) {
  return env.LC_ALL || env.LANG ? env : { ...env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' };
}

/**
 * The local development database. Production keeps `shiv_cement` (infra/docker-compose.yml), so a
 * local name that ends in `_dev` can never be mistaken for it, and tools that refuse anything but a
 * `_dev`, `_demo` or `_test` database can tell the two apart.
 */
export const devDatabase = 'shiv_cement_dev';
export const legacyDevDatabase = 'shiv_cement';

/**
 * Rewrites the DATABASE_URL line of an apps/api/.env text from the old local database name to the
 * new one. Only a loopback URL whose database is exactly the old name changes; every other line,
 * the credentials, the query string and any quotes stay as they were. Already renamed: unchanged.
 */
export function renamedDevEnv(text) {
  const lines = text.split('\n');
  const at = lines.flatMap((line, index) => (/^\s*DATABASE_URL\s*=/.test(line) ? [index] : []));
  if (at.length !== 1)
    throw new Error('apps/api/.env must have exactly one DATABASE_URL line; fix it by hand first.');
  const [, prefix, value] = /^(\s*DATABASE_URL\s*=\s*)(.*?)\s*$/.exec(lines[at[0]]);
  const quote = /^(['"]).*\1$/.test(value) ? value[0] : '';
  let url;
  try {
    url = new URL(quote ? value.slice(1, -1) : value);
  } catch {
    throw new Error('DATABASE_URL in apps/api/.env is not a valid URL.');
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Only a loopback development database is renamed.');
  if (url.pathname === `/${devDatabase}`) return { text, changed: false };
  if (url.pathname !== `/${legacyDevDatabase}`)
    throw new Error(
      `apps/api/.env uses the database "${decodeURIComponent(url.pathname.slice(1))}"; only "${legacyDevDatabase}" is renamed.`,
    );
  url.pathname = `/${devDatabase}`;
  lines[at[0]] = `${prefix}${quote}${url}${quote}`;
  return { text: lines.join('\n'), changed: true };
}

/**
 * Compares the migration folders in apps/api/prisma/migrations with the rows of Prisma's
 * `_prisma_migrations` table. A row counts as applied only when it finished and was not rolled
 * back; one that started and never finished is a failed migration.
 */
export function migrationState(folders, rows) {
  const names = folders.filter((name) => /^\d{14}_[a-z0-9_]+$/.test(name)).sort();
  const known = new Set(names);
  const applied = new Set(
    rows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name),
  );
  return {
    pending: names.filter((name) => !applied.has(name)),
    failed: rows
      .filter((row) => !row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name)
      .sort(),
    unknown: [...applied].filter((name) => !known.has(name)).sort(),
  };
}

const listed = (names) =>
  names.length > 3
    ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
    : names.join(', ');

/** The warning `local:start` and `local:status` print, or null when the database is current. */
export function migrationWarning({ pending, failed, unknown }, database) {
  const lines = [];
  if (failed.length)
    lines.push(
      `Database ${database}: ${failed.length} migration(s) failed part-way (${listed(failed)}). Check with: npm exec -w @shiv/api -- prisma migrate status`,
    );
  if (pending.length)
    lines.push(
      `Database ${database} is behind: ${pending.length} migration(s) not applied (${listed(pending)}). Pages will fail on missing tables. Run: npm run db:migrate -w @shiv/api`,
    );
  if (unknown.length)
    lines.push(
      `Database ${database} has ${unknown.length} migration(s) this checkout does not have (${listed(unknown)}); another branch migrated it.`,
    );
  return lines.length ? `WARNING: ${lines.join('\nWARNING: ')}` : null;
}
