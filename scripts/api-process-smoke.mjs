#!/usr/bin/env node
// Runs the real API entry point (node or docker) and checks startup, readiness, graceful
// SIGTERM with an open event stream, and that logs never contain listed secret values.
//
//   node scripts/api-process-smoke.mjs --expect=ready --url=http://127.0.0.1:4000 -- node apps/api/dist/main.js
//   node scripts/api-process-smoke.mjs --expect=refuse --match="restricted runtime" -- docker run ...
//
// SMOKE_FORBIDDEN: comma-separated values (passwords, secrets) that must never appear in output.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const split = args.indexOf('--');
if (split < 0) throw new Error('Usage: api-process-smoke.mjs [options] -- command ...');
const options = Object.fromEntries(
  args.slice(0, split).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  }),
);
const [command, ...commandArgs] = args.slice(split + 1);
const expect = options.expect || 'ready';
const base = (options.url || 'http://127.0.0.1:4000').replace(/\/$/, '');
const forbidden = (process.env.SMOKE_FORBIDDEN || '').split(',').filter((v) => v.length >= 6);
const startupMs = Number(options['startup-ms'] || 90_000);
const stopMs = Number(options['stop-ms'] || 12_000);

let output = '';
const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));
const exited = new Promise((resolve) =>
  child.on('exit', (code, signal) => resolve({ code, signal })),
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message) => {
  console.error(`FAIL: ${message}\n--- process output ---\n${output.slice(-4000)}`);
  child.kill('SIGKILL');
  process.exit(1);
};
const checkSecrets = () => {
  for (const value of forbidden)
    if (output.includes(value)) fail('a secret value appeared in logs');
};

if (expect === 'refuse') {
  const result = await Promise.race([exited, sleep(startupMs).then(() => null)]);
  if (!result) fail('process kept running; expected a startup refusal');
  if (result.code === 0) fail('process exited 0; expected a startup refusal');
  if (!output.includes('API_STARTUP_FAILED')) fail('no API_STARTUP_FAILED event');
  if (options.match && !output.includes(options.match)) fail(`output lacks "${options.match}"`);
  checkSecrets();
  console.log(`PASS: startup refused with exit ${result.code}; reason logged without secrets.`);
  process.exit(0);
}

const deadline = Date.now() + startupMs;
for (;;) {
  if (Date.now() > deadline) fail('API did not become ready in time');
  const early = await Promise.race([exited, sleep(0).then(() => null)]);
  if (early) fail(`API exited during startup (code ${early.code})`);
  try {
    const live = await fetch(`${base}/api/v1/health/live`);
    const ready = await fetch(`${base}/api/v1/health/ready`);
    if (live.ok && ready.ok) break;
  } catch {
    /* not listening yet */
  }
  await sleep(500);
}
if (!output.includes('API_STARTED')) fail('no API_STARTED event');
const controller = new globalThis.AbortController();
const stream = await fetch(`${base}/api/v1/events`, { signal: controller.signal });
if (stream.status !== 200) fail(`event stream returned ${stream.status}`);
const streamEnded = (async () => {
  const reader = stream.body.getReader();
  try {
    for (;;) if ((await reader.read()).done) return true;
  } catch {
    return false;
  }
})();
const started = Date.now();
child.kill('SIGTERM');
const result = await Promise.race([exited, sleep(stopMs).then(() => null)]);
const elapsed = Date.now() - started;
controller.abort();
if (!result) fail(`process did not stop within ${stopMs}ms of SIGTERM`);
if (result.code !== 0) fail(`process exited ${result.code} after SIGTERM`);
if (!(await streamEnded)) fail('open event stream was cut instead of ended');
for (const event of ['API_STOPPING', 'API_STOPPED'])
  if (!output.includes(event)) fail(`no ${event} event`);
checkSecrets();
console.log(
  `PASS: ready, event stream ended cleanly, exit 0 ${elapsed}ms after SIGTERM, no secrets logged.`,
);
