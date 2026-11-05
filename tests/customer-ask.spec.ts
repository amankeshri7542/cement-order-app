import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures';
import { apiUrl, appUrl, tab } from './app';

// Ask against a local stub of the advisor, in this test only: the server here keeps Ask switched
// off until it has passed its safety test. The contract is packages/shared/src/advisor.ts.
test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 800 } });

const cors = { 'access-control-allow-origin': appUrl, 'access-control-allow-credentials': 'true' };
const view = (over: object = {}) => ({
  id: 'turn1',
  clientTurnId: 'c',
  status: 'DONE',
  speaker: 'Shiv Cement AI',
  route: 'GENERAL_ADVICE',
  level: 'CHECKED',
  label: 'CHECKED',
  language: 'en',
  text: 'Keep cement off the floor. Use it within three months.',
  products: [],
  nudge: null,
  delivery: null,
  estimate: null,
  citations: [
    {
      slug: 'store-cement',
      title: 'Storing cement',
      href: '/guide/store-cement',
      citedText: 'x',
      checkedOn: '2027-03',
    },
  ],
  articles: [],
  followups: [],
  limit: null,
  whatsappUrl: null,
  feedback: null,
  createdAt: new Date().toISOString(),
  ...over,
});
const stream = (turn: object) =>
  [
    `event: status\ndata: ${JSON.stringify({ type: 'status', turnId: 'turn1', clientTurnId: 'c', text: '' })}\n\n`,
    `event: text\ndata: ${JSON.stringify({ type: 'text', text: 'Keep cement off the floor.' })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ type: 'done', turn })}\n\n`,
  ].join('');

async function stub(page: Page, turn: object = view()) {
  const feedback: unknown[] = [];
  const preflight = (route: Route) =>
    route.fulfill({
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-headers': 'content-type,x-advisor-device,accept,authorization',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      },
    });
  await page.route(`${apiUrl}/client-config`, (route) =>
    route.fulfill({
      headers: cors,
      json: {
        android: {
          minimumVersion: '1.0.0',
          latestVersion: '1.0.0',
          storeUrl: 'https://play.google.com/x',
        },
        askEnabled: true,
        awardsUrl: null,
      },
    }),
  );
  await page.route(`${apiUrl}/advisor/device`, (route) =>
    route.request().method() === 'OPTIONS'
      ? preflight(route)
      : route.fulfill({
          headers: cors,
          status: 201,
          json: { deviceToken: 'adv1.testdevice12345.sig' },
        }),
  );
  await page.route(`${apiUrl}/advisor/turns`, (route) =>
    route.request().method() === 'OPTIONS'
      ? preflight(route)
      : route.fulfill({
          status: 201,
          headers: { ...cors, 'content-type': 'text/event-stream' },
          body: stream(turn),
        }),
  );
  await page.route(`${apiUrl}/advisor/turns/turn1/feedback`, (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    feedback.push(route.request().postDataJSON());
    return route.fulfill({ headers: cors, json: { ok: true } });
  });
  await page.route(`${apiUrl}/advisor/conversations/current`, (route) =>
    route.request().method() === 'OPTIONS'
      ? preflight(route)
      : route.fulfill({ headers: cors, json: { ok: true } }),
  );
  return feedback;
}

test('off on the server, there is no Ask anywhere', async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByRole('heading', { name: "Today's rates", exact: true })).toBeVisible();
  await expect(tab(page, 'Ask')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Ask about building your home' })).toBeHidden();
});

test('Ask is a tab that keeps its conversation, its box and its speaker', async ({ page }) => {
  await stub(page);
  await page.goto(appUrl);
  await tab(page, 'Ask').click();
  await page.getByRole('button', { name: 'How do I store cement at site?', exact: true }).click();
  await expect(page.getByText('Shiv Cement AI', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Keep cement off the floor. Use it within three months.'),
  ).toBeVisible();
  await expect(page.getByText('Checked', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/From our guide: Storing cement\. Checked by a civil engineer, March 2027/),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Your question', exact: true }).fill('half a question');
  await tab(page, 'Orders').click();
  await tab(page, 'Home').click();
  await tab(page, 'Ask').click();
  await expect(
    page.getByText('Keep cement off the floor. Use it within three months.'),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your question', exact: true })).toHaveValue(
    'half a question',
  );
  await expect(
    page.getByText('Do not share your phone number or address here', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /mic|voice/i })).toHaveCount(0);
});

test('Not right can report an answer as offensive, inside the app', async ({ page }) => {
  const feedback = await stub(page);
  await page.goto(appUrl);
  await tab(page, 'Ask').click();
  await page.getByRole('button', { name: 'What do I buy first?', exact: true }).click();
  await page.getByRole('button', { name: 'Not right', exact: true }).click();
  await page.getByRole('button', { name: 'Offensive', exact: true }).click();
  await expect.poll(() => feedback).toEqual([{ value: 'NOT_RIGHT', reason: 'OFFENSIVE' }]);
  await expect(page.getByRole('button', { name: 'Not right', exact: true })).toBeHidden();
});

test('at the limit it shows matching articles and a WhatsApp button, and breaks nothing', async ({
  page,
}) => {
  await stub(
    page,
    view({
      limit: 'DEVICE',
      level: 'FIXED',
      label: null,
      text: 'You have asked a lot today. The guide is still here, or ask the shop.',
      citations: [],
      articles: [
        {
          slug: 'store-cement',
          title: 'Storing cement',
          titleHinglish: 'x',
          summary: 'x',
          href: '/guide/store-cement',
        },
      ],
      whatsappUrl: 'https://wa.me/919000000000',
    }),
  );
  await page.goto(appUrl);
  await tab(page, 'Ask').click();
  await page.getByRole('button', { name: 'What do I buy first?', exact: true }).click();
  await expect(page.getByText('You have asked a lot today.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Storing cement', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Ask the shop on WhatsApp', exact: true }),
  ).toBeVisible();
});

test('with no approved number the WhatsApp button stays hidden at the limit too', async ({
  page,
}) => {
  await stub(page, view({ limit: 'DEVICE', citations: [], whatsappUrl: null }));
  await page.goto(appUrl);
  await tab(page, 'Ask').click();
  await page.getByRole('button', { name: 'What do I buy first?', exact: true }).click();
  await expect(page.getByText('Shiv Cement AI', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Ask the shop on WhatsApp', exact: true }),
  ).toBeHidden();
});

test('offline, the question stays in the box and Send is off', async ({ page, context }) => {
  await stub(page);
  await page.goto(appUrl);
  await tab(page, 'Ask').click();
  await page.getByRole('textbox', { name: 'Your question', exact: true }).fill('my question');
  await context.setOffline(true);
  await expect(
    page.getByText('You are offline. Your question stays here.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send question', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Your question', exact: true })).toHaveValue(
    'my question',
  );
  await context.setOffline(false);
});
