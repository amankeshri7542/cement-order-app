// What the program learns about this PC. Fixed commands only, no shell, no PowerShell (plan 09:
// nothing an antivirus would rightly distrust). On a PC where a command is missing it just says so.
import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';

export function runCommand(file, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout) => {
        resolve(error ? null : String(stdout));
      },
    );
  });
}

export function makePlatform({ dataDir, run = runCommand } = {}) {
  return {
    osText: () => `${os.version()} ${os.arch()}`.slice(0, 120),
    async tallyRunning() {
      const out = await run('tasklist', ['/FI', 'IMAGENAME eq tally.exe', '/NH']);
      return Boolean(out && /tally\.exe/i.test(out));
    },
    async diskFreeMb(path = dataDir) {
      const stats = await statfs(path);
      return Math.floor((stats.bavail * stats.bsize) / (1024 * 1024));
    },
    async caps(spool) {
      return {
        diskFreeMb: await this.diskFreeMb(),
        ramMb: Math.floor(os.totalmem() / (1024 * 1024)),
        spoolMb: Math.floor((await spool.bytes()) / (1024 * 1024)),
      };
    },
  };
}
