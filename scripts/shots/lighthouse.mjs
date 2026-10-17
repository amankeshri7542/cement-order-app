// Mobile Lighthouse for the website's production build, with real catalogue data.
//
//   node scripts/shots/lighthouse.mjs <output.json> [runs=3]
//
// Run scripts/shots/prepare.mjs demo first. A production build refuses a plain-http API, so this
// serves the test API (NODE_ENV=test, the demo database) through a throwaway self-signed HTTPS
// proxy on localhost:4443 and builds the website against it (dist dir .next-lighthouse). Lighthouse
// runs with its default mobile emulation and simulated slow 4G; Chrome is told to accept only this
// temporary certificate's errors. Nothing here is deployed or added to package.json (npx).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const [output, runsArg] = process.argv.slice(2);
if (!output) throw new Error('Usage: lighthouse.mjs <output.json> [runs]');
const runs = Number(runsArg || 3);
const db = new URL(parseEnv(readFileSync('apps/api/.env.test', 'utf8')).TEST_DATABASE_URL);
db.pathname = '/shiv_shots_test';
const children = [];
const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('exit', stop);

async function waitFor(url, insecure = false) {
  for (let i = 0; i < 240; i++) {
    const ok = await new Promise((done) => {
      const target = new URL(url);
      const get = target.protocol === 'https:' ? import('node:https') : import('node:http');
      void get.then((m) =>
        m
          .get(url, { rejectUnauthorized: !insecure }, (res) => {
            res.resume();
            done(res.statusCode < 500);
          })
          .on('error', () => done(false)),
      );
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not start`);
}

const temp = mkdtempSync(join(tmpdir(), 'shiv-lh-'));
try {
  // 1. The test API on the demo database.
  const api = spawn(
    'npm',
    ['exec', '-w', '@shiv/api', '--', 'tsx', '--env-file=.env', 'scripts/e2e-api.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: db.toString(),
        NODE_ENV: 'test',
        PORT: '4021',
        OTP_PROVIDER: 'mock',
        OTP_HASH_SECRET: 'lighthouse-only-secret-at-least-32-characters',
        CORS_ORIGINS: 'http://localhost:3031',
        R2_PUBLIC_URL: 'https://assets.example.invalid',
      },
      stdio: 'ignore',
    },
  );
  children.push(api);
  await waitFor('http://localhost:4021/api/v1/health');

  // 2. A temporary self-signed certificate and an HTTPS proxy in front of it.
  spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-keyout',
      join(temp, 'key.pem'),
      '-out',
      join(temp, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  const proxy = createServer(
    { key: readFileSync(join(temp, 'key.pem')), cert: readFileSync(join(temp, 'cert.pem')) },
    (req, res) => {
      const upstream = request(
        {
          host: '127.0.0.1',
          port: 4021,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: 'localhost:4021' },
        },
        (answer) => {
          res.writeHead(answer.statusCode || 502, answer.headers);
          answer.pipe(res);
        },
      );
      upstream.on('error', () => res.writeHead(502).end());
      req.pipe(upstream);
    },
  ).listen(4443, '127.0.0.1');
  await waitFor('https://localhost:4443/api/v1/health', true);

  // 3. The production website, built against the HTTPS API.
  const env = {
    ...process.env,
    NEXT_PUBLIC_API_URL: 'https://localhost:4443/api/v1',
    NEXT_PUBLIC_ASSET_ORIGIN: 'https://assets.example.invalid',
    NEXT_DIST_DIR: '.next-lighthouse',
  };
  const built = spawnSync(
    'npm',
    ['exec', '-w', '@shiv/storefront', '--', 'next', 'build', '--webpack'],
    { env, stdio: 'ignore' },
  );
  if (built.status !== 0) throw new Error('Website build failed');
  const site = spawn(
    'npm',
    ['exec', '-w', '@shiv/storefront', '--', 'next', 'start', '--port', '3031'],
    { env: { ...env, NODE_ENV: 'production' }, stdio: 'ignore' },
  );
  children.push(site);
  await waitFor('http://localhost:3031/');

  // Optional: LH_PROBE=1 lists layout-shift sources in a throttled Chrome instead of Lighthouse.
  if (process.env.LH_PROBE) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome' });
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 823 },
      deviceScaleFactor: 1.75,
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      window.shifts = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          window.shifts.push({
            at: Math.round(e.startTime),
            value: e.value.toFixed(3),
            sources: e.sources.slice(0, 3).map((x) => ({
              node: x.node?.outerHTML?.slice(0, 70) || x.node?.nodeName,
              from: `${Math.round(x.previousRect.y)}h${Math.round(x.previousRect.height)}`,
              to: `${Math.round(x.currentRect.y)}h${Math.round(x.currentRect.height)}`,
            })),
          });
      }).observe({ type: 'layout-shift', buffered: true });
    });
    page.on(
      'console',
      (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 160)),
    );
    await page.goto('http://localhost:3031/');
    await page.waitForTimeout(8000);
    if (process.env.LH_PROBE_SHOT) await page.screenshot({ path: process.env.LH_PROBE_SHOT });
    console.log(JSON.stringify(await page.evaluate(() => window.shifts)));
    await browser.close();
    proxy.close();
    process.exit(0);
  }

  // 4. Lighthouse, mobile defaults, a few runs; the median run is kept.
  const results = [];
  for (let i = 0; i < runs; i++) {
    const file = join(temp, `run-${i}.json`);
    const run = spawnSync(
      'npx',
      [
        '--yes',
        'lighthouse@12',
        'http://localhost:3031/',
        '--quiet',
        '--output=json',
        `--output-path=${file}`,
        '--only-categories=performance,accessibility,best-practices',
        '--chrome-flags=--headless=new --ignore-certificate-errors',
      ],
      { stdio: 'ignore' },
    );
    if (run.status !== 0) throw new Error('Lighthouse failed');
    const report = JSON.parse(readFileSync(file, 'utf8'));
    const audit = (id) => report.audits[id]?.numericValue;
    results.push({
      performance: Math.round(report.categories.performance.score * 100),
      accessibility: Math.round(report.categories.accessibility.score * 100),
      bestPractices: Math.round(report.categories['best-practices'].score * 100),
      fcpMs: Math.round(audit('first-contentful-paint')),
      lcpMs: Math.round(audit('largest-contentful-paint')),
      tbtMs: Math.round(audit('total-blocking-time')),
      cls: Number(audit('cumulative-layout-shift').toFixed(3)),
      speedIndexMs: Math.round(audit('speed-index')),
      transferKiB: Math.round(audit('total-byte-weight') / 1024),
      lighthouse: report.lighthouseVersion,
      failedA11y: Object.values(report.audits)
        .filter(
          (a) =>
            a.score === 0 && report.categories.accessibility.auditRefs.some((r) => r.id === a.id),
        )
        .map((a) => ({
          id: a.id,
          nodes: (a.details?.items || []).map((item) => item.node?.snippet).filter(Boolean),
        })),
      layoutShifts: (report.audits['layout-shifts']?.details?.items || []).map((item) => ({
        score: Number(item.score?.toFixed?.(3) ?? item.score),
        node: item.node?.snippet,
        causes: (item.subItems?.items || []).map(
          (sub) => sub.extra?.value || sub.cause || JSON.stringify(sub).slice(0, 120),
        ),
      })),
      shiftCulprits: (report.audits['layout-shift-elements']?.details?.items || [])
        .slice(0, 5)
        .map((item) => item.node?.snippet),
    });
  }
  results.sort((a, b) => a.performance - b.performance);
  const median = results[Math.floor(results.length / 2)];
  writeFileSync(output, JSON.stringify({ median, runs: results }, null, 2));
  console.log(JSON.stringify(median));
  proxy.close();
} finally {
  stop();
  rmSync(temp, { recursive: true, force: true });
}
process.exit(0);
