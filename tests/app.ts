import type { Page } from '@playwright/test';
import { expect, verifyAndSkipName } from './fixtures';

// How the browser journeys drive the customer app (Expo web build on :8082). Keeping the app's
// labels in one place means a design change touches these helpers, not every journey.
export const appUrl = 'http://localhost:8082';
export const apiUrl = 'http://localhost:4010/api/v1';

/** Completes the open sign-in sheet with the local mock code. */
export async function verifyCode(page: Page, phone: string) {
  await page.getByRole('textbox', { name: 'Mobile number (+91)', exact: true }).fill(phone);
  const requested = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code', exact: true }).click();
  const code = (await (await requested).json()).devCode;
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await verifyAndSkipName(page, () =>
    page.getByRole('button', { name: 'Verify & continue', exact: true }).click(),
  );
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Verify & continue', exact: true })).toBeHidden();
}

/** Signs in from the Account tab and stays there. */
export async function appLogin(page: Page, phone: string) {
  await page.goto(appUrl);
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await verifyCode(page, phone);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}

export const tab = (page: Page, name: 'Home' | 'Materials' | 'Orders' | 'Account') =>
  page.getByRole('tab', { name, exact: true });
/** The Basket tab; its accessible name carries the item count, e.g. "Basket, 12". */
export const basketTab = (page: Page) => page.getByRole('tab', { name: /^Basket/ });

/** Opens the Basket and waits for it (the Materials row shares its quantity field's name). */
export async function openBasket(page: Page) {
  await basketTab(page).click();
  await expect(page.getByRole('heading', { name: 'Your basket', exact: true })).toBeVisible();
}

/** Opens Materials and narrows the list to `query`. */
export async function searchMaterials(page: Page, query: string) {
  await tab(page, 'Materials').click();
  const search = page.getByRole('textbox', { name: 'Search materials', exact: true });
  // WebKit can drop text typed before the list's first commit: wait for it, then check the value.
  await expect(
    page.getByText(/^\d+ (materials?|सामग्री)( · (more below|नीचे और))?$/),
  ).toBeVisible();
  await expect(async () => {
    await search.fill(query);
    await expect(search).toHaveValue(query, { timeout: 1000 });
  }).toPass();
}
/** A product's row on Materials (name, price, Add and the in-basket quantity bar). */
export const productRow = (page: Page, id: string) => page.getByTestId(`product-${id}`);

export async function openMaterial(page: Page, name: string) {
  await searchMaterials(page, name);
  await page.getByRole('button', { name: `View ${name}`, exact: true }).click();
}

/** Adds an address on the Saved addresses screen (or the form it opens with). */
export async function fillAddress(
  page: Page,
  values: { name: string; line1: string; area: string; pincode: string; label?: string },
) {
  const fields: [string, string | undefined][] = [
    ['House, plot or street', values.line1],
    ['Area / locality', values.area],
    ['Pincode', values.pincode],
    ['Person receiving', values.name],
    ['Name this address (Home / Site)', values.label],
  ];
  for (const [name, value] of fields)
    if (value !== undefined) await page.getByRole('textbox', { name, exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
}

/** From the Basket: review the order, then place it with cash on delivery. */
export async function placeOrder(page: Page) {
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
}
