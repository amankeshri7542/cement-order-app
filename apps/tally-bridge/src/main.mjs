// The shop PC's program. `pair <code>` once, then Task Scheduler runs it through the launcher.
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from './agent.mjs';
import { BridgeApi, loadIdentity, newIdentity, pair, saveIdentity } from './api-client.mjs';
import { EXIT_STOPPED, EXIT_UPDATE_READY } from './launcher.mjs';
import { makePlatform } from './platform.mjs';
import { Spool } from './spool.mjs';
import { TallyClient } from './tally-client.mjs';
import { Updater } from './update.mjs';
import { AGENT_VERSION } from './version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LOG_CAP = 5 * 1024 * 1024;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJson(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

/** Ids and counts only. The field list is what the agent passes; names and amounts never reach it. */
export function makeLog(dataDir) {
  const path = join(dataDir, 'bridge.log');
  return (event, fields = {}) => {
    const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`;
    stat(path)
      .then(async (info) => {
        if (info.size > LOG_CAP) await rename(path, `${path}.old`);
      })
      .catch(() => undefined)
      .finally(() => appendFile(path, line, { mode: 0o600 }).catch(() => undefined));
  };
}

export async function makeAgent({
  dataDir,
  config,
  updateKeyPem,
  fetchImpl,
  allowLoopbackHttp = false,
}) {
  const log = makeLog(dataDir);
  const privateKey = await loadIdentity(dataDir);
  const statePath = join(dataDir, 'state.json');
  const state = await readJson(statePath, { deviceId: config.deviceId });
  const api = new BridgeApi({
    base: config.api,
    privateKey,
    state,
    saveState: (value) => writeJson(statePath, value),
    allowLoopbackHttp,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const updater = new Updater({
    dataDir,
    currentVersion: AGENT_VERSION,
    publicKeyPem: updateKeyPem,
    log,
    onReady: () => process.exit(EXIT_UPDATE_READY),
  });
  await updater.load();
  const spool = new Spool(join(dataDir, 'spool'));
  await spool.ready();
  return new Agent({
    tally: new TallyClient({ port: config.port ?? 9000 }),
    api,
    spool,
    platform: makePlatform({ dataDir }),
    version: AGENT_VERSION,
    updater,
    log,
  });
}

export async function cli(argv, env = process.env) {
  const [command, ...rest] = argv;
  const dataDir = env.SHIV_BRIDGE_DATA || join(env.ProgramData || here, 'ShivBridge');
  const options = Object.fromEntries(
    rest.flatMap((word, index) =>
      word.startsWith('--') ? [[word.slice(2), rest[index + 1]]] : [],
    ),
  );
  const configPath = join(dataDir, 'config.json');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (command === 'pair') {
    const code = rest[0];
    if (!/^\d{8}$/.test(code ?? '') || !options.api) {
      console.error('Use: main.mjs pair <8 digit code> --api https://api.example [--port 9000]');
      return 2;
    }
    // A new key each time: a PC that was cut off comes back as a new PC, and an old key stays dead.
    // It replaces the old one only once the server has taken it.
    const privateKey = newIdentity();
    const platform = makePlatform({ dataDir });
    const reply = await pair({
      base: options.api,
      code,
      privateKey,
      version: AGENT_VERSION,
      os: platform.osText(),
    });
    await saveIdentity(dataDir, privateKey);
    await writeJson(join(dataDir, 'state.json'), { deviceId: reply.deviceId });
    await writeJson(configPath, {
      api: options.api,
      deviceId: reply.deviceId,
      port: options.port ? Number(options.port) : 9000,
    });
    console.log(`Connected as ${reply.name}.`);
    return 0;
  }
  if (command === 'run') {
    const config = await readJson(configPath, null);
    if (!config) {
      console.error('This PC is not connected yet. Run pair first.');
      return 2;
    }
    const keyPath = join(env.SHIV_BRIDGE_DIR || here, 'update-key.pub');
    const agent = await makeAgent({
      dataDir,
      config,
      updateKeyPem: existsSync(keyPath) ? readFileSync(keyPath, 'utf8') : null,
    });
    await agent.loop();
    return EXIT_STOPPED;
  }
  console.error('Use: main.mjs pair <code> --api <https address> | run');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = await cli(process.argv.slice(2));
