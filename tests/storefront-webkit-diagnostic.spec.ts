import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';

// Run separately: RUN_STOREFRONT_WEBKIT_DIAGNOSTIC=1 npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit tests/storefront-webkit-diagnostic.spec.ts
// The default suite does not register this known native diagnostic; its explicit run fails on every observed page error.
if (process.env.RUN_STOREFRONT_WEBKIT_DIAGNOSTIC === '1') {
  test.use({ trace: 'on', screenshot: 'on' });
  test.describe('original native WebKit hard-navigation diagnostic', () => {
    test.beforeAll(async () => {
      const url = process.env.TEST_DATABASE_URL;
      if (
        !url ||
        !new URL(url).pathname.endsWith('_test') ||
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
      )
        throw new Error('Disposable loopback test DB required.');
      const db = new PrismaClient({ datasourceUrl: url });
      try {
        await db.category.upsert({
          where: { id: 'test-v2' },
          update: {},
          create: { id: 'test-v2', name: 'TEST materials', slug: 'test-v2' },
        });
        const product = {
          id: 'test-v2-26',
          name: 'TEST V2 Material 26',
          brand: 'TEST Brand B',
          categoryId: 'test-v2',
          type: 'PPC Cement',
          grade: 'PPC',
          unit: 'bag',
          packSize: '50 kg',
          minQuantity: 10,
          quantityStep: 5,
          pricePaise: 12625,
          stock: 0,
          active: true,
          images: [],
          description: 'Isolated TEST material for original native WebKit navigation diagnostic.',
          recommendedUse: 'TEST construction only.',
        };
        await db.product.upsert({ where: { id: product.id }, create: product, update: product });
      } finally {
        await db.$disconnect();
      }
    });

    test('out-of-stock → missing → empty search preserves the original hard-navigation timing', async ({
      page,
      browserName,
    }, info) => {
      test.skip(browserName !== 'webkit', 'This diagnostic targets native WebKit.');
      const errors: { message: string; url: string }[] = [];
      const requests: { url: string; error: string | null }[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (error) => errors.push({ message: error.message, url: page.url() }));
      page.on('requestfailed', (request) =>
        requests.push({ url: request.url(), error: request.failure()?.errorText ?? null }),
      );
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      let failure: string | null = null;
      try {
        // No mocked EventSource, lifecycle wrapper, network-idle wait, pause or extra readiness check between these navigations.
        await page.goto('http://localhost:3004/products/test-v2-26');
        await expect(page.getByText(/out of stock/i).first()).toBeVisible();
        await page.goto('http://localhost:3004/products/does-not-exist');
        await expect(
          page.getByRole('heading', { name: 'This material is not available.', exact: true }),
        ).toBeVisible();
        await page.goto('http://localhost:3004/products?q=NO-SUCH-TEST-V2-MATERIAL');
        await expect(page.getByText(/no materials|no products/i).first()).toBeVisible();
        expect(
          errors,
          'Every native page error is retained; no access-control diagnostic is suppressed.',
        ).toEqual([]);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        await info.attach('original-native-webkit-hard-navigation', {
          body: JSON.stringify(
            {
              outcome: failure || errors.length ? 'FAIL' : 'PASS',
              failure,
              errors,
              requests,
              consoleErrors,
              scenario: [
                'test-v2-26 + visible Out of stock',
                'does-not-exist + visible unavailable heading',
                'empty-search URL',
              ],
              note: 'Native WebKit, original document-navigation order and readiness boundaries. Trace retained on both pass and fail.',
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      }
    });
  });
}
