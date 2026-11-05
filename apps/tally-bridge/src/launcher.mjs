// What Task Scheduler starts, and what rarely changes. It runs the newest version that works, and
// goes back to the old one if a new one fails to report healthy three times. It knows nothing else.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT_UPDATE_READY = 75;
export const EXIT_STOPPED = 78;
const MAX_TRIES = 3;
const here = dirname(fileURLToPath(import.meta.url));

/** Which version to run next, and what to remember. Pure, so a bad update can be tested in a second. */
export function nextRun(state) {
  if (state.pending && state.pendingTries >= MAX_TRIES)
    return {
      run: state.current,
      state: { current: state.current, pending: null, pendingTries: 0 },
      rolledBack: state.pending,
    };
  if (state.pending)
    return {
      run: state.pending,
      state: { ...state, pendingTries: (state.pendingTries ?? 0) + 1 },
      rolledBack: null,
    };
  return { run: state.current, state, rolledBack: null };
}

const dirOf = (dataDir, version) =>
  version === 'base' ? here : join(dataDir, 'versions', version);

async function readState(dataDir) {
  try {
    return JSON.parse(await readFile(join(dataDir, 'launcher.json'), 'utf8'));
  } catch {
    return { current: 'base', pending: null, pendingTries: 0 };
  }
}

function runOnce(dataDir, version) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(dirOf(dataDir, version), 'main.mjs'), 'run'], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, SHIV_BRIDGE_DATA: dataDir, SHIV_BRIDGE_DIR: here },
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

export async function launch({ dataDir, waitMs = 15000, runner = runOnce, maxRuns = Infinity }) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let state = await readState(dataDir);
  for (let runs = 0; runs < maxRuns; runs++) {
    const pendingFile = join(dataDir, 'pending.json');
    if (existsSync(pendingFile)) {
      const { version } = JSON.parse(await readFile(pendingFile, 'utf8'));
      await rm(pendingFile, { force: true });
      state = { ...state, pending: version, pendingTries: 0 };
    }
    const step = nextRun(state);
    state = step.state;
    if (step.rolledBack) {
      await writeFile(join(dataDir, 'update-failed.txt'), step.rolledBack);
      await rm(join(dataDir, 'versions', step.rolledBack), { recursive: true, force: true });
    }
    await writeFile(join(dataDir, 'launcher.json'), JSON.stringify(state));
    const code = await runner(dataDir, step.run);
    if (code === EXIT_STOPPED) return { stopped: true, state };
    if (state.pending && existsSync(join(dataDir, `healthy-${state.pending}`))) {
      state = { current: state.pending, pending: null, pendingTries: 0 };
      await rm(join(dataDir, 'update-failed.txt'), { force: true });
      await writeFile(join(dataDir, 'launcher.json'), JSON.stringify(state));
    }
    if (code !== EXIT_UPDATE_READY) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return { stopped: false, state };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dataDir =
    process.env.SHIV_BRIDGE_DATA || join(process.env.ProgramData || here, 'ShivBridge');
  await launch({ dataDir });
}
