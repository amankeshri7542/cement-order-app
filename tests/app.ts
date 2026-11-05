import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// How the browser journeys drive the customer app (Expo web build on :8082). Keeping the app's
// labels in one place means a design change touches these helpers, not every journey.
export const appUrl = 'http://localhost:8082';
export const apiUrl = 'http://localhost:4010/api/v1';

/** Completes the open sign-in sheet with the local mock code. */
export async function verifyCode(page: Page, phone: string) {
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(phone);
  const requested = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'Get code', exact: true }).click();
  const code = (await (await requested).json()).devCode;
  await page.getByRole('textbox', { name: 'Code from SMS', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verify and continue', exact: true })).toBeHidden();
}

/** Signs in from the Account tab and stays there. */
export async function appLogin(page: Page, phone: string) {
  await page.goto(appUrl);
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await verifyCode(page, phone);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}

export const tab = (page: Page, name: 'Home' | 'Ask' | 'Orders' | 'Account') =>
  page.getByRole('tab', { name, exact: true });

/** Opens Search from Home and narrows the list to `query`. */
export async function searchMaterials(page: Page, query: string) {
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill(query);
}
/** Adds a product to the list from Search, and comes back to Home. */
export async function addToList(page: Page, name: string, quantity?: number) {
  await searchMaterials(page, name);
  await page.getByRole('button', { name: `Add ${name} to your list`, exact: true }).click();
  if (quantity !== undefined) {
    const box = page.getByRole('textbox', { name: `${name} quantity`, exact: true });
    await box.fill(String(quantity));
    await box.blur();
  }
  await page.getByRole('button', { name: 'Back', exact: true }).click();
}
export const openList = (page: Page) => page.getByTestId('list-bar').click();

type Site = { pincode: string; line1: string; name: string; area?: string; landmark?: string };
/** Fills the open Add a site sheet and saves it. */
export async function fillSite(page: Page, site: Site) {
  const dialog = page.getByRole('dialog').last();
  await dialog.getByRole('textbox', { name: 'Pincode', exact: true }).fill(site.pincode);
  await expect(dialog.getByText(/We deliver here|We do not deliver here/)).toBeVisible();
  await dialog.getByRole('textbox', { name: 'House, plot or gali', exact: true }).fill(site.line1);
  // The form asks for the area only where the shop has not filled one in for this pincode.
  const area = dialog.getByRole('textbox', { name: 'Area', exact: true });
  if (await area.isVisible()) await area.fill(site.area ?? 'Kankarbagh');
  if (site.landmark !== undefined)
    await dialog
      .getByRole('textbox', { name: 'Landmark, for the driver', exact: true })
      .fill(site.landmark);
  await dialog.getByRole('textbox', { name: 'Who receives it', exact: true }).fill(site.name);
  await dialog.getByRole('button', { name: 'Save site', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save site', exact: true })).toBeHidden();
}
/** Adds a site from Account, for a customer who is already signed in. */
export async function addSite(page: Page, site: Site) {
  await tab(page, 'Account').click();
  await page.getByRole('button', { name: 'Sites', exact: false }).first().click();
  await page.getByRole('button', { name: 'Add a site', exact: true }).click();
  await fillSite(page, site);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
}

export const placeButton = (page: Page) => page.getByRole('button', { name: /^Place order/ });
export const waiting = (page: Page) =>
  page.getByRole('heading', { name: 'Waiting for the shop', exact: true });
/** From the open panel: waits for the server's total, then places it. */
export async function placeOrder(page: Page) {
  await expect(placeButton(page)).toBeEnabled();
  await placeButton(page).click();
  await expect(waiting(page)).toBeVisible();
}
