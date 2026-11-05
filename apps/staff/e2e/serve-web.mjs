// Builds the Expo web bundle for browser tests and serves it. Test-only: this app ships on Android.
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const out = join(app, '..', '..', '.local', 'staff-e2e', 'web');
const require = createRequire(import.meta.url);
const built = spawnSync(
  process.execPath,
  [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', out, '--clear'],
  { cwd: app, stdio: 'inherit', env: process.env },
);
if (built.status !== 0) process.exit(built.status ?? 1);

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};
createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const asked = join(out, path);
  const file =
    asked.startsWith(out) && existsSync(asked) && statSync(asked).isFile()
      ? asked
      : join(out, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(8083, '127.0.0.1');
