#!/usr/bin/env node
// Measures the installed Android app on a connected emulator/phone against the plan's targets:
// cold start < 2.5 s, smooth product scrolling, APK < 30 MB. Needs the local API running
// (npm run local:start) and a release build installed (APP_VARIANT=local).
//
//   node scripts/android-baseline.mjs [--runs 5] [--serial emulator-5554]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const root = new URL('..', import.meta.url).pathname;
const pkg = 'in.shivcement.store';
const runs = Number(arg('runs', 5));
const sdk = process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk');
const serial = arg('serial', '');
const adb = (...args) =>
  execFileSync(join(sdk, 'platform-tools/adb'), [...(serial ? ['-s', serial] : []), ...args], {
    encoding: 'utf8',
  });
const apiLog = join(root, '.local/api.log');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

adb('reverse', 'tcp:4000', 'tcp:4000');
const device = {
  model: adb('shell', 'getprop', 'ro.product.model').trim(),
  android: adb('shell', 'getprop', 'ro.build.version.release').trim(),
  size: adb('shell', 'wm', 'size').trim().split(': ').pop(),
  density: adb('shell', 'wm', 'density').trim().split(': ').pop(),
};

const apk = join(root, 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk');
const apkMb = existsSync(apk) ? +(statSync(apk).size / 1e6).toFixed(1) : null;

// Cold start: process killed, then launched. "First frame" is Android's TotalTime; "JS ready"
// is when the app's first catalogue request reaches the API (bundle loaded, React running).
const firstFrame = [];
const jsReady = [];
for (let run = 0; run < runs; run++) {
  adb('shell', 'am', 'force-stop', pkg);
  await sleep(1500);
  const logSize = existsSync(apiLog) ? statSync(apiLog).size : 0;
  const started = Date.now();
  const output = adb('shell', 'am', 'start', '-W', '-n', `${pkg}/.MainActivity`);
  firstFrame.push(Number(output.match(/TotalTime: (\d+)/)?.[1]));
  for (let waited = 0; waited < 15000; waited += 50) {
    const fresh = existsSync(apiLog) ? readFileSync(apiLog, 'utf8').slice(logSize) : '';
    const line = fresh.split('\n').find((entry) => entry.includes('"route":"/api/v1/'));
    if (line) {
      jsReady.push(Date.parse(JSON.parse(line).timestamp) - started);
      break;
    }
    await sleep(50);
  }
  await sleep(2500);
}

// Scrolling: open Products, fling through the list, read the frame statistics.
const { width, height } = Object.fromEntries(
  device.size.split('x').map((value, index) => [index ? 'height' : 'width', Number(value)]),
);
adb('shell', 'input', 'tap', String(Math.round(width * 0.375)), String(Math.round(height * 0.86)));
await sleep(2500);
adb('shell', 'dumpsys', 'gfxinfo', pkg, 'reset');
for (let swipe = 0; swipe < 8; swipe++) {
  const [from, to] = swipe < 6 ? [0.72, 0.3] : [0.3, 0.72];
  adb(
    'shell',
    'input',
    'swipe',
    String(width / 2),
    String(Math.round(height * from)),
    String(width / 2),
    String(Math.round(height * to)),
    '250',
  );
  await sleep(700);
}
const gfx = adb('shell', 'dumpsys', 'gfxinfo', pkg);
const frames = Number(gfx.match(/Total frames rendered: (\d+)/)?.[1]);
const janky = gfx.match(/Janky frames: (\d+) \(([\d.]+)%\)/);
const p90 = Number(gfx.match(/90th percentile: (\d+)ms/)?.[1]);
const memory = adb('shell', 'dumpsys', 'meminfo', pkg).match(/TOTAL(?: PSS)?:?\s+(\d+)/)?.[1];

const result = {
  measuredAt: new Date().toISOString(),
  device,
  apkMb,
  coldStartFirstFrameMs: { median: median(firstFrame), runs: firstFrame },
  coldStartJsReadyMs: { median: median(jsReady), runs: jsReady },
  scroll: {
    frames,
    jankyFrames: Number(janky?.[1]),
    jankyPercent: Number(janky?.[2]),
    p90FrameMs: p90,
  },
  memoryPssMb: memory ? Math.round(Number(memory) / 1024) : null,
  targets: { coldStartMs: 2500, apkMb: 30, jankyPercent: 5 },
};
mkdirSync(join(root, '.local/android'), { recursive: true });
const file = join(root, `.local/android/baseline-${device.model.replace(/\W+/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
console.log(`Saved ${file}`);
