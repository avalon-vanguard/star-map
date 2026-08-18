import { Locator, Page } from '@playwright/test';

/**
 * The search lives in the dock along the bottom, behind its own tab, so a test that wants to
 * type has to open it first — the way a user does, or with the `/` shortcut. Returns the field.
 */
export async function openSearch(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Search' }).click();
  return page.getByPlaceholder('Search stars, planets, exoplanets…');
}
