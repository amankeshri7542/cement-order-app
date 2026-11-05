import { expect, test } from '@playwright/test';
import {
  adminPost,
  audit,
  db,
  decide,
  floodTitle,
  linked,
  numbers,
  pairScreen,
  liveQr,
  resetWorld,
  scan,
  signIn,
} from './world';

test.beforeEach(resetWorld);

test('first link: number, code, yours, notice, waiting, shop QR, approved', async ({ page }) => {
  await page.goto('/');
  await audit(page, 'number');
  await signIn(page, 'keeper');
  await expect(page.getByText('Yeh phone aapke naam hoga')).toBeVisible();
  await audit(page, 'yours');
  await page.getByTestId('yours-ok').click();
  await expect(page.getByText('Hazri ki suchna')).toBeVisible();
  await audit(page, 'notice');
  await page.getByTestId('notice-accept').click();
  await expect(page.getByText('Manzoori ka intezaar')).toBeVisible();
  await audit(page, 'waiting');
  // Until someone agrees, the server refuses this phone everything but linking.
  expect(await db.staffDevice.findFirst({ where: { userId: 'keeper' } })).toMatchObject({
    status: 'PENDING',
  });
  expect(await db.staffNoticeAck.count({ where: { userId: 'keeper' } })).toBe(1);

  await page.getByTestId('link-check').click();
  await expect(page.getByTestId('link-note')).toContainText('Abhi nahi aayi');

  const { token } = await pairScreen();
  await page.getByTestId('scan-proof').click();
  await scan(page, await liveQr(token));
  await expect(page.getByTestId('proof-done')).toBeVisible();
  expect(
    (await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'keeper' } })).qrScannedAt,
  ).not.toBeNull();

  await decide('keeper');
  await page.getByTestId('link-check').click();
  await expect(page.getByTestId('screen-hazri')).toBeVisible();
  await expect(page.getByText('Namaste Test')).toBeVisible();
});

test('the waiting screen opens by itself once someone agrees', async ({ page }) => {
  await signIn(page, 'keeper');
  await page.getByTestId('yours-ok').click();
  await page.getByTestId('notice-accept').click();
  await page.getByTestId('screen-waiting').waitFor();
  await decide('keeper');
  await expect(page.getByTestId('screen-hazri')).toBeVisible({ timeout: 25000 });
});

test('a code from a screen that is not ours is refused as proof', async ({ page }) => {
  await signIn(page, 'keeper');
  await page.getByTestId('yours-ok').click();
  await page.getByTestId('notice-accept').click();
  await page.getByTestId('scan-proof').click();
  await scan(page, 'https://example.com/not-a-shop');
  await expect(floodTitle(page)).toHaveText('Yeh hamara QR nahi hai');
  await audit(page, 'proof refused');
  await page.getByTestId('flood-rescan').click();
  await scan(page, 'SHV1.ABC234.88888888.AAAAAAAAAAAAAAAA');
  await expect(floodTitle(page)).toHaveText('Yeh hamara QR nahi hai');
});

test('refused: told plainly, tokens gone, and they can start again', async ({ page }) => {
  await signIn(page, 'keeper');
  await page.getByTestId('yours-ok').click();
  await page.getByTestId('notice-accept').click();
  await page.getByTestId('screen-waiting').waitFor();
  await decide('keeper', 'REFUSE');
  await page.getByTestId('link-check').click();
  await expect(page.getByText('Manzoori nahi mili')).toBeVisible();
  await audit(page, 'refused');
  const secret = await page.evaluate(() => localStorage.getItem('staff:secure:staff_session'));
  expect(secret).toBeNull();
  await page.getByTestId('relink').click();
  await expect(page.getByTestId('screen-number')).toBeVisible();
});

test('a number not on the staff is told so, and no account is made', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('phone-input').fill('9000007999');
  await page.getByTestId('number-next').click();
  await page.getByTestId('dev-code').waitFor();
  const code = ((await page.getByTestId('dev-code').textContent()) ?? '').replace(/\D/g, '');
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-next').click();
  await expect(page.getByTestId('code-error')).toContainText(
    'Yeh number staff mein nahi hai. Malik se poochho.',
  );
  expect(await db.user.findUnique({ where: { phone: '+919000007999' } })).toBeNull();
  await audit(page, 'not staff');
});

test('a wrong code, a bad number and the OTP limit each read plainly', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('phone-input').fill('12345');
  await page.getByTestId('number-next').click();
  await expect(page.getByTestId('number-error')).toContainText('Number dekho: 10 ank.');

  await page.getByTestId('phone-input').fill(numbers.keeper);
  await page.getByTestId('number-next').click();
  await page.getByTestId('dev-code').waitFor();
  await page.getByTestId('code-input').fill('000000');
  await page.getByTestId('code-next').click();
  await expect(page.getByTestId('code-error')).toContainText('Code sahi nahi hai. Dobara daalo.');

  // Asking again at once is the limit.
  await page.getByTestId('code-resend').click();
  await expect(page.getByTestId('code-error')).toContainText(
    'Bahut baar try hua. Thodi der baad try karo.',
  );
  await audit(page, 'otp limit');
});

test('new phone: only an owner can agree, and the lost one is cut off at once', async ({
  browser,
}) => {
  const first = await (
    await browser.newContext({ viewport: { width: 360, height: 640 } })
  ).newPage();
  await linked(first, 'keeper');
  await db.otpChallenge.deleteMany({});
  await db.authRateLimit.deleteMany({});

  const second = await (
    await browser.newContext({ viewport: { width: 360, height: 640 } })
  ).newPage();
  await second.goto('/');
  await second.getByTestId('new-phone').click();
  await second.getByTestId('reason-broken').click();
  await audit(second, 'number with reason');
  await signIn(second, 'keeper').catch(() => {});
  await second.getByTestId('yours-ok').click();
  await expect(second.getByTestId('screen-new-phone')).toBeVisible();
  await expect(second.getByText('Naya phone hai, malik se poochho')).toBeVisible();
  await audit(second, 'new phone');
  const asked = await db.deviceLinkRequest.findFirstOrThrow({
    where: { userId: 'keeper', status: 'PENDING' },
  });
  expect(asked.kind).toBe('CHANGE');
  // A manager cannot.
  await expect(
    adminPost('manager', `device-requests/${asked.id}/decide`, { decision: 'APPROVE' }),
  ).rejects.toThrow(/403/);

  await second.getByTestId('lost-old').click();
  await expect(floodTitle(second).or(second.getByText('Purana phone band kar diya'))).toBeVisible();
  await audit(second, 'lost');
  expect(await db.staffDevice.count({ where: { userId: 'keeper', status: 'LOST' } })).toBe(1);

  // The old phone finds out next time it asks, and wipes.
  await first.reload();
  await expect(first.getByTestId('screen-cut-off')).toBeVisible();
  await audit(first, 'cut off');
  await first.context().close();

  await second.getByTestId('lost-ok').click();
  await decide('keeper');
  await second.getByTestId('link-check').click();
  await expect(second.getByTestId('screen-hazri')).toBeVisible();
  await second.context().close();
});

test('the language switch sits in one place, and Simple English is real', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Apna number daalo')).toBeVisible();
  await page.getByTestId('language-switch').click();
  await expect(page.getByText('Enter your number')).toBeVisible();
  await audit(page, 'english');
  await page.reload();
  await expect(page.getByText('Enter your number')).toBeVisible();
  await page.getByTestId('language-switch').click();
  await expect(page.getByText('Apna number daalo')).toBeVisible();
});
