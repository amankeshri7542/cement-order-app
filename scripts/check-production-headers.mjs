/* global document, performance */
import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';

// API responses are simulated; only the one-day self-signed localhost TLS fixture bypasses certificate trust. CSP stays enforced.
const evidence = [];
const servers = [];
const evidenceDir = process.env.HEADER_EVIDENCE_DIR || '.local/security-hardening';
for (const [port, upstream] of [
  [3443, 3002],
  [8443, 8083],
  [3445, 3005],
]) {
  const server = createServer(
    {
      key: readFileSync(`${evidenceDir}/tls.key`),
      cert: readFileSync(`${evidenceDir}/tls.crt`),
    },
    (req, res) => {
      const forward = request(
        {
          hostname: 'localhost',
          port: upstream,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      forward.on('error', () => res.writeHead(502).end());
      req.pipe(forward);
    },
  );
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  servers.push(server);
}
try {
  for (const [engine, browserType] of [
    ['chrome', chromium],
    ['webkit', webkit],
  ]) {
    const browser = await browserType.launch(engine === 'chrome' ? { channel: 'chrome' } : {});
    try {
      for (const [frontend, url] of [
        ['owner', 'https://localhost:3443'],
        ['customer', 'https://localhost:8443'],
        ['storefront', 'https://localhost:3445'],
      ]) {
        const page = await browser.newPage({ ignoreHTTPSErrors: true });
        const errors = [];
        const scripts = new Map();
        const scriptReads = [];
        const collectScript = (response) => {
          if (response.request().resourceType() === 'script' && response.ok()) {
            scriptReads.push(
              response
                .body()
                .then((body) => scripts.set(response.url(), gzipSync(body).byteLength)),
            );
          }
        };
        if (frontend === 'storefront') page.on('response', collectScript);
        page.on('pageerror', (error) => errors.push(error.message));
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
        const headers = response.headers(),
          csp = headers['content-security-policy'];
        const scriptPolicy = csp.split(';').find((v) => v.trim().startsWith('script-src'));
        assert(!scriptPolicy.includes('unsafe-inline'));
        assert(!scriptPolicy.includes('unsafe-eval'));
        assert(csp.includes("frame-ancestors 'none'"));
        assert.equal(headers['x-content-type-options'], 'nosniff');
        assert(headers['strict-transport-security'].includes('max-age='));
        await page.waitForFunction(
          () => document.body.innerText.length > 40 && document.querySelector('button'),
        );
        if (frontend === 'storefront') {
          assert(headers['cache-control'].includes('no-store'));
          await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
          assert.equal(await page.locator('html').getAttribute('lang'), 'hi');
          await page.getByRole('button', { name: 'English', exact: true }).click();
          page.off('response', collectScript);
          await Promise.all(scriptReads);
          const gzipScriptBytes = [...scripts.values()].reduce((sum, size) => sum + size, 0);
          assert(
            gzipScriptBytes > 0 && gzipScriptBytes <= 450 * 1024,
            'Storefront initial scripts exceed 450 KiB gzip budget',
          );
          const timing = await page.evaluate(() => ({
            navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
            paint: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
          }));
          evidence.push({
            frontend,
            engine,
            gzipScriptBytes,
            timing,
            note: 'Local TLS, unthrottled production build; unavailable API simulated',
          });
        }
        const violations = [];
        page.on('console', (message) => {
          if (/Content Security Policy|script-src/i.test(message.text()))
            violations.push(message.text());
        });
        await page.route(`${url}/`, async (route) => {
          const original = await route.fetch();
          await route.fulfill({
            response: original,
            body: (await original.text()).replace(
              '</head>',
              '<script>document.documentElement.dataset.injected = "yes"</script></head>',
            ),
          });
        });
        await page.reload();
        await page.waitForFunction(
          () => document.body.innerText.length > 40 && document.querySelector('button'),
        );
        assert(violations.length > 0);
        assert.equal(await page.locator('html').getAttribute('data-injected'), null);
        assert.deepEqual(errors, []);
        if (frontend === 'owner') {
          const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
          assert(nonce);
          const next = await page.reload();
          assert(!next.headers()['content-security-policy'].includes(`'nonce-${nonce}'`));
        }
        await page.screenshot({
          path: `${evidenceDir}/production-${engine}-${frontend}.png`,
        });
        evidence.push({
          engine,
          frontend,
          rendered: true,
          injectedScriptBlocked: true,
          errors,
          headers,
        });
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  writeFileSync(`${evidenceDir}/production-headers.json`, JSON.stringify(evidence, null, 2));
  console.log(
    'PASS: production Chrome/WebKit owner, customer and storefront UI render with enforced CSP; injected scripts blocked. API responses simulated.',
  );
} finally {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
