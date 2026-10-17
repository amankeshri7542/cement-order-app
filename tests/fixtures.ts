import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
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

/**
 * The app asks for a language on first launch and the owner desk opens in Hindi. Journeys run
 * both in English unless a test chooses otherwise, so they start past the chooser. Apply to extra contexts with `skipLanguageChooser`.
 */
export async function skipLanguageChooser(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      if (location.port === '8082' && !localStorage.getItem('shiv_language'))
        localStorage.setItem('shiv_language', '"en"');
      // The owner desk opens in Hindi; journeys drive it in English unless a test picks Hindi.
      if (location.port === '3001' && !localStorage.getItem('shiv-owner-language'))
        localStorage.setItem('shiv-owner-language', 'en');
    } catch {
      /* Storage blocked: the chooser appears instead. */
    }
  });
}

/**
 * Presses the verify button. A customer account without a name is then asked for one, once per
 * browser (Phase 11); this skips that question so a journey continues where it was going. The
 * answer from /auth/otp/verify decides, so the step is never guessed from timing.
 */
export async function verifyAndSkipName(page: Page, verify: () => Promise<unknown>) {
  const verified = page.waitForResponse(
    (response) =>
      response.url().endsWith('/auth/otp/verify') && response.request().method() === 'POST',
  );
  await verify();
  const response = await verified;
  const user = response.ok()
    ? ((await response.json().catch(() => null))?.user as
        { id: string; name: string; role: string } | undefined)
    : undefined;
  if (!user || user.role === 'ADMIN' || user.name.trim()) return;
  const asked = await page.evaluate((id) => {
    try {
      return localStorage.getItem(`shiv_name_asked_${id}`);
    } catch {
      return null;
    }
  }, user.id);
  if (!asked) await page.getByRole('button', { name: /^(Skip for now|अभी छोड़ें)$/ }).click();
}

export const test = base.extend<{ authBudget: void; browserEvidence: void; appLanguage: void }>({
  appLanguage: [
    async ({ context }, use) => {
      await skipLanguageChooser(context);
      await use();
    },
    { auto: true },
  ],
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
