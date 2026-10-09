import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

// Each browser journey represents independent people. Preserve production limits
// within a journey without charging every journey to the same loopback IP.
export function observePage(page: Page, info: TestInfo) {
  const events: object[] = [];
  page.on('pageerror', (error) => events.push({ kind: 'pageerror', message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') events.push({ kind: 'console', message: message.text() });
  });
  page.on('requestfailed', (request) =>
    events.push({
      kind: 'requestfailed',
      method: request.method(),
      url: request.url(),
      error: request.failure()?.errorText,
    }),
  );
  page.on('response', (response) => {
    if (response.status() >= 400)
      events.push({ kind: 'http', status: response.status(), url: response.url() });
  });
  page.on('close', () => {
    void info.attach('browser-events', {
      body: JSON.stringify(events, null, 2),
      contentType: 'application/json',
    });
  });
  return events;
}

export const test = base.extend<{ authBudget: void; browserEvidence: void }>({
  browserEvidence: [
    async ({ page, browser }, use, info) => {
      await info.attach('browser-environment', {
        body: JSON.stringify({
          browser: browser.browserType().name(),
          version: browser.version(),
          viewport: page.viewportSize(),
        }),
        contentType: 'application/json',
      });
      const events = observePage(page, info);
      await use();
      await info.attach('browser-events-main', {
        body: JSON.stringify(events, null, 2),
        contentType: 'application/json',
      });
      expect(
        events.filter(
          (event) =>
            'message' in event &&
            typeof event.message === 'string' &&
            event.message.includes('Unexpected text node'),
        ),
        'Views must not render raw text children',
      ).toEqual([]);
    },
    { auto: true },
  ],
  authBudget: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture dependencies to be destructured.
    async ({}, use) => {
      const url = process.env.TEST_DATABASE_URL;
      if (!url || !new URL(url).pathname.endsWith('_test'))
        throw new Error('Browser fixtures require a disposable _test database.');
      const db = new PrismaClient({ datasourceUrl: url });
      try {
        await db.$transaction([db.authRateLimit.deleteMany(), db.otpChallenge.deleteMany()]);
      } finally {
        await db.$disconnect();
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
