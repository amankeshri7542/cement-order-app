import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminPost, audit, db, floodTitle, linked, MAIN, resetWorld } from './world';

test.beforeEach(resetWorld);

const lastMonth = () => {
  const now = new Date(Date.now() + 5.5 * 3600000);
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return at.toISOString().slice(0, 7);
};
const salary = (path: string, body: object, method = 'POST') =>
  adminPost('papa', `salary/${path}`, body, method);
async function payKeeper(amountPaise = 1400000) {
  const month = lastMonth();
  await salary('terms/keeper', { effectiveFrom: `${month}-01`, amountPaise: 1500000 }, 'PUT');
  await salary(`runs/${month}/lock`, { confirm: true });
  const paid = await salary(`runs/${month}/pay`, {
    userId: 'keeper',
    amountPaise,
    channel: 'UPI',
    paidFrom: 'OWNER',
    idempotencyKey: randomUUID(),
  });
  return { month, id: paid.id as string };
}
const openPaisa = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('tab-paisa').click();
  await page.getByTestId('screen-paisa').waitFor();
};

test('someone with no pay set: reads fine, and does not look broken', async ({ page }) => {
  await linked(page, 'keeper');
  await openPaisa(page);
  await expect(page.getByTestId('paisa-empty')).toContainText(
    'Abhi yahan koi salary nahi likhi hai.',
  );
  await expect(page.getByTestId('paisa-empty')).toContainText('Malik likhenge tab yahan dikhegi.');
  await audit(page, 'paisa empty');
  await expect(page.locator('body')).not.toContainText(/error|undefined|null|NaN/i);
});

test('"Mil gaya?": Haan, mil gaya goes on the record, and is not asked again', async ({ page }) => {
  const { id } = await payKeeper();
  await linked(page, 'keeper');
  await openPaisa(page);
  await expect(page.getByTestId('pay-ask')).toContainText('₹14,000 UPI se bheja gaya. Mil gaya?');
  await expect(page.getByTestId('pay-monthly')).toHaveText('₹15,000');
  await audit(page, 'paisa ask');
  await page.getByTestId('pay-got').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  await expect(floodTitle(page)).toHaveText('Mil gaya');
  await audit(page, 'paisa got');
  expect(await db.paymentAck.findUniqueOrThrow({ where: { entryId: id } })).toMatchObject({
    answer: 'GOT',
    userId: 'keeper',
  });
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('pay-ask')).toHaveCount(0);
  await expect(page.getByTestId(`payment-${id}`)).toContainText('Mil gaya');
});

test('"Nahi mila" reaches the owners at once, and can still become "ab mil gaya"', async ({
  page,
}) => {
  const { id } = await payKeeper();
  await linked(page, 'keeper');
  await openPaisa(page);
  await page.getByTestId('pay-not-got').click();
  await expect(floodTitle(page)).toHaveText('Nahi mila');
  await expect(page.getByText('Malik ko bata diya.')).toBeVisible();
  expect(await db.paymentAck.findUniqueOrThrow({ where: { entryId: id } })).toMatchObject({
    answer: 'NOT_GOT',
  });
  const told = await db.notification.findMany({
    where: { dedupeKey: { startsWith: 'pay-not-got:' } },
  });
  expect(new Set(told.map((row) => row.userId))).toEqual(new Set(['papa', 'chacha']));
  await page.getByTestId('flood-home').click();
  await audit(page, 'paisa not got');
  await page.getByTestId(`pay-got-now-${id}`).click();
  await expect(floodTitle(page)).toHaveText('Mil gaya');
  expect((await db.paymentAck.findUniqueOrThrow({ where: { entryId: id } })).answer).toBe('GOT');
});

test('an answer with no signal waits on the phone, and goes once', async ({ page, context }) => {
  const { id } = await payKeeper();
  await linked(page, 'keeper');
  await openPaisa(page);
  await page.getByTestId('pay-got').waitFor();
  await context.setOffline(true);
  await page.getByTestId('pay-got').click();
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await expect(page.getByText('Abhi gaya nahi')).toBeVisible();
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('pay-ask')).toHaveCount(0);
  await expect(page.getByTestId(`payment-${id}`)).toContainText('Abhi gaya nahi');
  await context.setOffline(false);
  await expect
    .poll(async () => (await db.paymentAck.findUnique({ where: { entryId: id } }))?.answer, {
      timeout: 25000,
    })
    .toBe('GOT');
});

test('the slip reads Bana, Advance kata, Milega', async ({ page }) => {
  await db.staffMembership.findFirst();
  const month = lastMonth();
  await salary('terms/keeper', { effectiveFrom: `${month}-01`, amountPaise: 1500000 }, 'PUT');
  await salary('advances', {
    userId: 'keeper',
    amountPaise: 400000,
    recoveryPaise: 100000,
    channel: 'CASH',
    paidFrom: 'OWNER',
    idempotencyKey: randomUUID(),
  });
  await salary(`runs/${month}/lock`, { confirm: true });
  await linked(page, 'keeper');
  await openPaisa(page);
  await expect(page.getByTestId('pay-advance')).toHaveText('₹3,000');
  await page.getByTestId(`slip-${month}`).click();
  await expect(page.getByText('Bana')).toBeVisible();
  await expect(page.getByText('Advance kata')).toBeVisible();
  await expect(page.getByText('Milega')).toBeVisible();
  await expect(page.getByTestId('slip-net')).toHaveText('₹14,000');
  await audit(page, 'slip');
});

test('only this person’s own figures: another’s payment cannot be answered', async ({ page }) => {
  const { id } = await payKeeper();
  await linked(page, 'driver');
  await openPaisa(page);
  await expect(page.getByTestId('paisa-empty')).toBeVisible();
  const reply = await page.evaluate(
    async ({ payment, api }) => {
      const session = JSON.parse(localStorage.getItem('staff:secure:staff_session')!);
      const res = await fetch(`${api}/staff/me/payments/${payment}/ack`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'GOT' }),
      });
      return res.status;
    },
    { payment: id, api: 'http://localhost:4020/api/v1' },
  );
  expect(reply).toBe(403);
  expect(await db.paymentAck.count()).toBe(0);
  void MAIN;
});
