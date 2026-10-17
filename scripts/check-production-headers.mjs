/* global document, performance */
import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import securityHeaders from '../apps/mobile/web-security.cjs';
import { applicationIdentity, assertPortFree } from './local-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const frontends = [
  { name: 'owner', identity: 'admin', directory: 'apps/admin', port: 43120, tls: 43123 },
  { name: 'customer', identity: 'customer', directory: 'apps/mobile', port: 43121, tls: 43124 },
  {
    name: 'storefront',
    identity: 'storefront',
    directory: 'apps/storefront',
    port: 43122,
    tls: 43125,
  },
];

function checkHeaders(headers, frontend) {
  const csp = headers['content-security-policy'] || '';
  const scriptPolicy = csp.split(';').find((v) => v.trim().startsWith('script-src '));
  assert(scriptPolicy, `${frontend}: missing script-src`);
  assert(!scriptPolicy.includes('unsafe-inline') && !scriptPolicy.includes('unsafe-eval'));
  assert(csp.includes("frame-ancestors 'none'"));
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert(headers['strict-transport-security']?.includes('max-age='));
  assert(headers['cache-control']?.includes('no-store'));
  const microphone = headers['permissions-policy']
    ?.split(',')
    .find((v) => v.trim().startsWith('microphone='))
    ?.trim();
  assert.equal(microphone, frontend === 'storefront' ? 'microphone=(self)' : 'microphone=()');
  const nonce = /'nonce-([^']+)'/.exec(scriptPolicy)?.[1];
  if (frontend !== 'customer') assert(nonce, `${frontend}: missing document nonce`);
  return nonce;
}

function checkDocumentNonces(nonce, scripts) {
  const executable = scripts.filter(
    (script) =>
      !script.type || /^(module|text\/javascript|application\/javascript)$/i.test(script.type),
  );
  if (nonce) {
    assert(
      scripts.some((script) => script.nonce === nonce),
      'CSP nonce is absent from DOM scripts',
    );
    assert(
      scripts.every((script) => !script.nonce || script.nonce === nonce),
      'DOM/CSP nonce mismatch',
    );
    assert(
      executable.every((script) => script.src || !script.text || script.nonce === nonce),
      'Executable inline script lacks matching nonce',
    );
  } else {
    assert(
      scripts.every((script) => !script.nonce),
      'DOM nonce without corresponding CSP',
    );
    assert(
      executable.every((script) => script.src || !script.text),
      'Static customer export contains executable inline script',
    );
  }
}

function scriptSizes(scripts, excluded = new Set()) {
  const measured = [...scripts].filter(([url]) => !excluded.has(url));
  return {
    scriptBytes: measured.reduce((sum, [, size]) => sum + size.bytes, 0),
    gzipScriptBytes: measured.reduce((sum, [, size]) => sum + size.gzipBytes, 0),
    scripts: Object.fromEntries(measured),
  };
}

function isInjectionDocument(request, url) {
  return (
    request.resourceType() === 'document' &&
    request.method() === 'GET' &&
    request.url() === `${url}/`
  );
}

if (process.argv.includes('--self-test')) {
  const headers = {
    'content-security-policy':
      "script-src 'self' 'nonce-first' 'strict-dynamic'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'strict-transport-security': 'max-age=31536000',
    'cache-control': 'no-store',
    'permissions-policy': 'camera=(), microphone=(self)',
  };
  assert.equal(checkHeaders(headers, 'storefront'), 'first');
  assert.throws(() =>
    checkHeaders({ ...headers, 'permissions-policy': 'microphone=*' }, 'storefront'),
  );
  assert.throws(() =>
    checkHeaders(
      { ...headers, 'content-security-policy': "script-src 'self'; frame-ancestors 'none'" },
      'storefront',
    ),
  );
  assert.throws(() => checkDocumentNonces('first', [{ nonce: 'second', text: 'run()', src: '' }]));
  assert.throws(() =>
    checkDocumentNonces('first', [
      { nonce: 'first', src: '/app.js' },
      { nonce: '', text: 'injected()', src: '' },
    ]),
  );
  checkDocumentNonces('first', [{ nonce: 'first', text: 'run()', src: '' }]);
  checkDocumentNonces(undefined, [{ nonce: '', text: '', src: '/app.js' }]);
  assert.throws(() => checkDocumentNonces(undefined, [{ nonce: '', text: 'injected()', src: '' }]));
  const scriptFixture = new Map([
    ['/core.js', { bytes: 100, gzipBytes: 50 }],
    ['/assistant.js', { bytes: 40, gzipBytes: 30 }],
  ]);
  assert.equal(scriptSizes(scriptFixture).gzipScriptBytes, 80);
  assert.deepEqual(scriptSizes(scriptFixture, new Set(['/core.js'])), {
    scriptBytes: 40,
    gzipScriptBytes: 30,
    scripts: { '/assistant.js': { bytes: 40, gzipBytes: 30 } },
  });
  assert.equal(scriptSizes(scriptFixture, new Set(scriptFixture.keys())).scriptBytes, 0);
  const requestFixture = (type, url, method = 'GET') => ({
    resourceType: () => type,
    url: () => url,
    method: () => method,
  });
  const origin = 'https://localhost:43125';
  assert(isInjectionDocument(requestFixture('document', `${origin}/`), origin));
  assert(!isInjectionDocument(requestFixture('fetch', `${origin}/`), origin));
  assert(!isInjectionDocument(requestFixture('fetch', `${origin}/?_rsc=fixture`), origin));
  assert(!isInjectionDocument(requestFixture('document', `${origin}/?_rsc=fixture`), origin));
  assert(!isInjectionDocument(requestFixture('document', `${origin}/`, 'POST'), origin));
  console.log(
    'PASS: production header/nonce, incremental script-size and document-routing regression self-checks',
  );
  process.exit(0);
}

// API responses are simulated; certificate trust is bypassed only for this temporary localhost fixture.
const evidence = [];
const servers = [],
  browsers = [],
  children = [],
  generated = [],
  snapshots = [];
const evidenceDir = resolve(root, process.env.HEADER_EVIDENCE_DIR || '.local/security-hardening');
mkdirSync(evidenceDir, { recursive: true });
function recordEvidence(entry) {
  evidence.push(entry);
  writeFileSync(join(evidenceDir, 'production-headers.json'), JSON.stringify(evidence, null, 2));
}
const temporary = mkdtempSync(join(tmpdir(), 'shiv-production-headers-'));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  CI: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  EXPO_NO_TELEMETRY: '1',
  EXPO_NO_DOTENV: '1',
  NEXT_DIST_DIR: '.next-security',
  NEXT_PUBLIC_API_URL: 'https://api.security.invalid/api/v1',
  NEXT_PUBLIC_ASSET_ORIGIN: 'https://assets.security.invalid',
  EXPO_PUBLIC_API_URL: 'https://api.security.invalid/api/v1',
  EXPO_PUBLIC_ASSET_ORIGIN: 'https://assets.security.invalid',
  EXPO_PUBLIC_PRIVACY_URL: 'https://localhost:43123/privacy',
};
process.env.EXPO_PUBLIC_API_URL = env.EXPO_PUBLIC_API_URL;
process.env.EXPO_PUBLIC_ASSET_ORIGIN = env.EXPO_PUBLIC_ASSET_ORIGIN;
let cleanupPromise;

function start(command, args, cwd, label) {
  const log = createWriteStream(join(evidenceDir, `${label}.log`));
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${label} exited (${code ?? signal}); see ${label}.log`)),
    );
  });
  done.catch(() => {});
  children.push({ child, done, log });
  return { child, done };
}

function signalChild(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    for (const server of servers) server.closeAllConnections();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    for (const { child } of children) signalChild(child, 'SIGTERM');
    await Promise.all(
      children.map(async ({ child, done, log }) => {
        const timer = setTimeout(() => signalChild(child, 'SIGKILL'), 5000);
        await done.catch(() => {});
        clearTimeout(timer);
        log.end();
      }),
    );
    for (const snapshot of snapshots) {
      const current = existsSync(snapshot.path) ? readFileSync(snapshot.path) : undefined;
      if ('after' in snapshot && (snapshot.after ? !current?.equals(snapshot.after) : current)) {
        recordEvidence({ warning: `Preserved concurrent change to ${snapshot.path}` });
        continue;
      }
      if (snapshot.before) writeFileSync(snapshot.path, snapshot.before);
      else rmSync(snapshot.path, { force: true });
    }
    for (const directory of generated) rmSync(directory, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
    writeFileSync(join(evidenceDir, 'production-headers.json'), JSON.stringify(evidence, null, 2));
  })();
  return cleanupPromise;
}

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(code));
  });
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  servers.push(server);
}
try {
  for (const frontend of frontends) {
    await assertPortFree(frontend.port);
    await assertPortFree(frontend.tls);
  }
  writeFileSync(
    join(temporary, 'openssl.cnf'),
    '[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n',
  );
  await start(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(temporary, 'tls.key'),
      '-out',
      join(temporary, 'tls.crt'),
      '-days',
      '1',
      '-config',
      join(temporary, 'openssl.cnf'),
    ],
    root,
    'certificate',
  ).done;
  for (const frontend of frontends.filter((item) => item.name !== 'customer')) {
    const directory = join(root, frontend.directory);
    const output = join(directory, '.next-security');
    mkdirSync(output); // Refuse an existing fixture; never remove another run's files.
    generated.push(output);
    const appSnapshots = ['tsconfig.json', 'next-env.d.ts'].map((file) => {
      const path = join(directory, file);
      const snapshot = { path, before: existsSync(path) ? readFileSync(path) : undefined };
      snapshots.push(snapshot);
      return snapshot;
    });
    try {
      await start(
        process.execPath,
        [require.resolve('next/dist/bin/next'), 'build', '--webpack'],
        directory,
        `build-${frontend.name}`,
      ).done;
    } finally {
      for (const snapshot of appSnapshots)
        snapshot.after = existsSync(snapshot.path) ? readFileSync(snapshot.path) : undefined;
    }
    frontend.process = start(
      process.execPath,
      [
        require.resolve('next/dist/bin/next'),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(frontend.port),
      ],
      directory,
      `serve-${frontend.name}`,
    );
  }
  const customerRoot = join(temporary, 'customer');
  await start(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', customerRoot],
    join(root, 'apps/mobile'),
    'build-customer',
  ).done;
  const customerHeaders = securityHeaders();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  };
  await listen(
    createServer(async (req, res) => {
      for (const [key, value] of Object.entries(customerHeaders)) res.setHeader(key, value);
      res.setHeader('Cache-Control', 'no-store');
      if (!['GET', 'HEAD'].includes(req.method)) return void res.writeHead(405).end();
      try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        let file = resolve(customerRoot, `.${pathname}`);
        if (!file.startsWith(`${customerRoot}${sep}`) && file !== customerRoot)
          return void res.writeHead(400).end();
        if (!(await stat(file).catch(() => null))?.isFile()) {
          if (extname(pathname)) return void res.writeHead(404).end();
          file = join(customerRoot, 'index.html');
        }
        const bytes = await readFile(file);
        res.setHeader('Content-Type', contentTypes[extname(file)] || 'application/octet-stream');
        res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch {
        res.writeHead(400).end();
      }
    }),
    frontends.find((item) => item.name === 'customer').port,
  );
  for (const frontend of frontends) {
    const deadline = Date.now() + 60000;
    while (
      !(await applicationIdentity(frontend.identity, `http://127.0.0.1:${frontend.port}`)).matches
    ) {
      assert(Date.now() < deadline, `${frontend.name} readiness/identity failed`);
      assert(
        !frontend.process ||
          (frontend.process.child.exitCode === null && frontend.process.child.signalCode === null),
        `${frontend.name} exited before readiness`,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await listen(
      createHttpsServer(
        {
          key: readFileSync(join(temporary, 'tls.key')),
          cert: readFileSync(join(temporary, 'tls.crt')),
        },
        (req, res) => {
          const forward = request(
            {
              hostname: '127.0.0.1',
              port: frontend.port,
              path: req.url,
              method: req.method,
              headers: req.headers,
            },
            (response) => {
              res.writeHead(response.statusCode, response.headers);
              response.pipe(res);
            },
          );
          forward.on('error', () => {
            if (!res.headersSent) res.writeHead(502);
            res.end();
          });
          res.on('close', () => forward.destroy());
          req.pipe(forward);
        },
      ),
      frontend.tls,
    );
  }
  for (const [engine, browserType] of [
    ['chrome', chromium],
    ['webkit', webkit],
  ]) {
    const browser = await browserType.launch(engine === 'chrome' ? { channel: 'chrome' } : {});
    browsers.push(browser);
    try {
      for (const { name: frontend, tls } of frontends) {
        const url = `https://localhost:${tls}`;
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const tracePath = join(evidenceDir, `production-${engine}-${frontend}-trace.zip`);
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        const page = await context.newPage();
        const errors = [];
        const consoleMessages = [];
        const pageErrors = [];
        const failedRequests = [];
        const responses = [];
        let phase = 'initial-document';
        let failed = false;
        try {
          const scripts = new Map();
          const scriptReads = [];
          const collectScript = (response) => {
            if (response.request().resourceType() === 'script' && response.ok()) {
              scriptReads.push(
                response.body().then((body) =>
                  scripts.set(response.url(), {
                    bytes: body.byteLength,
                    gzipBytes: gzipSync(body).byteLength,
                  }),
                ),
              );
            }
          };
          if (frontend === 'storefront') page.on('response', collectScript);
          page.on('pageerror', (error) => {
            errors.push(error.message);
            pageErrors.push({ phase, message: error.message, stack: error.stack });
          });
          page.on('console', (message) =>
            consoleMessages.push({
              phase,
              type: message.type(),
              text: message.text(),
              location: message.location(),
            }),
          );
          page.on('requestfailed', (request) =>
            failedRequests.push({
              phase,
              url: request.url(),
              resourceType: request.resourceType(),
              failure: request.failure(),
            }),
          );
          page.on('response', (response) =>
            responses.push({
              phase,
              url: response.url(),
              resourceType: response.request().resourceType(),
              status: response.status(),
              contentType: response.headers()['content-type'],
            }),
          );
          await page.route('https://api.security.invalid/**', (route) =>
            route.fulfill({
              status: 401,
              contentType: 'application/json',
              headers: {
                'access-control-allow-origin': new URL(url).origin,
                'access-control-allow-credentials': 'true',
              },
              body: JSON.stringify({
                error: { code: 'UNAUTHORIZED', message: 'Simulated signed-out state' },
              }),
            }),
          );
          const response = await page.goto(url);
          assert.equal(response.status(), 200);
          const headers = response.headers();
          const nonce = checkHeaders(headers, frontend);
          await page.waitForFunction(
            () => document.body.innerText.length > 40 && document.querySelector('button'),
          );
          const domScripts = () =>
            page.locator('script').evaluateAll((nodes) =>
              nodes.map((node) => ({
                nonce: node.nonce,
                src: node.src,
                type: node.type,
                text: node.textContent?.trim(),
              })),
            );
          checkDocumentNonces(nonce, await domScripts());
          if (frontend === 'storefront') {
            phase = 'storefront-interactions';
            assert(headers['cache-control'].includes('no-store'));
            await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
            assert.equal(await page.locator('html').getAttribute('lang'), 'hi');
            await page.getByRole('button', { name: 'English', exact: true }).click();
            page.off('response', collectScript);
            await Promise.all(scriptReads);
            const core = scriptSizes(scripts);
            assert(
              core.gzipScriptBytes > 0 && core.gzipScriptBytes <= 450 * 1024,
              'Storefront initial scripts exceed 450 KiB gzip budget',
            );
            const timing = await page.evaluate(() => ({
              navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
              paint: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
            }));
            recordEvidence({
              frontend,
              engine,
              ...core,
              timing,
              note: 'Local TLS, unthrottled production build; unavailable API simulated',
            });
            const coreUrls = new Set(scripts.keys());
            page.on('response', collectScript);
            await page.getByRole('button', { name: /Shiv Assistant/ }).click();
            await page.waitForFunction(
              () => document.querySelector('dialog[aria-labelledby="assistant-title"]')?.open,
            );
            page.off('response', collectScript);
            await Promise.all(scriptReads);
            const assistant = scriptSizes(scripts, coreUrls);
            assert(assistant.scriptBytes > 0, 'Assistant did not fetch a separate lazy script');
            recordEvidence({
              frontend,
              engine,
              feature: 'assistant',
              ...assistant,
              note: 'Incremental JavaScript after explicit assistant click and open dialog; core script URLs excluded. No assistant budget asserted.',
            });
            await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
          }
          phase = 'nonce-reload';
          const next = await page.reload();
          assert.equal(next.status(), 200);
          const nextNonce = checkHeaders(next.headers(), frontend);
          if (nonce) assert(nextNonce && nextNonce !== nonce, `${frontend}: nonce did not rotate`);
          checkDocumentNonces(nextNonce, await domScripts());
          const violations = [];
          page.on('console', (message) => {
            if (/Content Security Policy|script-src/i.test(message.text()))
              violations.push(message.text());
          });
          await page.route(`${url}/`, async (route) => {
            if (!isInjectionDocument(route.request(), url)) return route.continue();
            const original = await route.fetch();
            assert(
              original.headers()['content-type']?.includes('text/html'),
              'CSP injection requires an HTML document',
            );
            const html = await original.text();
            assert(html.includes('</head>'), 'CSP injection document has no closing head');
            await route.fulfill({
              response: original,
              body: html.replace(
                '</head>',
                '<script>document.documentElement.dataset.injected = "yes"</script></head>',
              ),
            });
          });
          phase = 'injected-document';
          await page.reload();
          await page.waitForFunction(
            () => document.body.innerText.length > 40 && document.querySelector('button'),
          );
          assert(violations.length > 0);
          assert.equal(await page.locator('html').getAttribute('data-injected'), null);
          assert.deepEqual(errors, []);
          await page.screenshot({
            path: `${evidenceDir}/production-${engine}-${frontend}.png`,
          });
          recordEvidence({
            engine,
            frontend,
            rendered: true,
            injectedScriptBlocked: true,
            noncePresent: Boolean(nonce),
            nonceRotated: nonce ? true : null,
            domNonceMatches: true,
            errors,
            headers,
          });
        } catch (error) {
          failed = true;
          recordEvidence({
            engine,
            frontend,
            phase,
            failure: error.stack || String(error),
            tracePath,
            errors,
            pageErrors,
            consoleMessages,
            failedRequests,
            responses,
          });
          const captures = await Promise.allSettled([
            page.screenshot({
              path: join(evidenceDir, `production-${engine}-${frontend}-failure.png`),
            }),
            page
              .content()
              .then((html) =>
                writeFileSync(
                  join(evidenceDir, `production-${engine}-${frontend}-failure.html`),
                  html,
                ),
              ),
          ]);
          for (const capture of captures)
            if (capture.status === 'rejected')
              recordEvidence({ engine, frontend, captureFailure: String(capture.reason) });
          throw error;
        } finally {
          try {
            await context.tracing.stop({ path: tracePath }).then(
              () => recordEvidence({ engine, frontend, tracePath, failed }),
              (error) => {
                recordEvidence({ engine, frontend, traceFailure: error.stack || String(error) });
                if (!failed) throw error;
              },
            );
          } finally {
            await context.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
  console.log(
    'PASS: production Chrome/WebKit owner, customer and storefront render with enforced CSP; injected scripts blocked; applicable nonces match and rotate. API responses simulated.',
  );
} catch (error) {
  recordEvidence({ failure: error.stack || String(error) });
  throw error;
} finally {
  await cleanup();
}
