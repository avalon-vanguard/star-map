import { Locator, Page } from '@playwright/test';

/**
 * The search lives in the dock along the bottom, behind its own tab, so a test that wants to
 * type has to open it first — the way a user does, or with the `/` shortcut. Returns the field.
 */
export async function openSearch(page: Page): Promise<Locator> {
  // Clicking the active tab folds it closed, so only click when it is not already open.
  const tab = page.getByRole('tab', { name: 'Search' });
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
  }
  return page.getByPlaceholder('Search stars, planets, exoplanets…');
}
