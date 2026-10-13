import { test, expect } from './fixtures';

test('owner response CSP uses fresh nonces and blocks injected inline scripts', async ({
  page,
}) => {
  const response = await page.goto('http://localhost:3001');
  const policy = response!.headers()['content-security-policy'];
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  const nonce = /'nonce-([^']+)'/.exec(policy!)?.[1];
  expect(nonce).toBeTruthy();
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|script-src/i.test(message.text())) violations.push(message.text());
  });
  await page.route('http://localhost:3001/', async (route) => {
    const original = await route.fetch();
    await route.fulfill({
      response: original,
      body: (await original.text()).replace(
        '</head>',
        '<script>document.documentElement.dataset.injected = "yes"</script></head>',
      ),
    });
  });
  const next = await page.reload();
  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(await page.locator('html').getAttribute('data-injected')).toBeNull();
  expect(next!.headers()['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
  expect(next!.headers()['x-content-type-options']).toBe('nosniff');
  expect(next!.headers()['referrer-policy']).toBe('no-referrer');
});

test('customer web server sends frame, content and exact API-origin restrictions', async ({
  page,
}) => {
  const response = await page.goto('http://localhost:8082');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain('http://localhost:4010');
  expect(headers['content-security-policy']).toContain("base-uri 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('tab', { name: 'Products', exact: true })).toBeVisible();
});
