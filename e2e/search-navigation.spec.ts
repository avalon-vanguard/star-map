import { expect, test } from '@playwright/test';

import { openSearch } from './support/open-search';
import { backButtonLocator } from './support/wait-for-back-button';

test.describe('Search-driven navigation', () => {
  test('selecting a star result flies into that system and shows the back-to-galaxy control', async ({ page }) => {
    await page.goto('/?stars=4000');
    const searchInput = await openSearch(page);
    await searchInput.fill('Proxima Centauri');

    const result = page.getByRole('button', { name: /Proxima Centauri/ });
    await expect(result).toBeVisible();
    await result.click();

    // Selecting a result hands the dock straight back to the readout (before the flight even
    // starts): the thing to look at is now the scene, and the search panel folds away with it.
    await expect(page.getByRole('tab', { name: 'Readout' })).toHaveAttribute('aria-selected', 'true');
    await expect(searchInput).toHaveCount(0);
    await expect(backButtonLocator(page)).toBeVisible({ timeout: 15_000 });
  });

  test('the system flown into is in the URL, so a reload lands in it and Back retraces it', async ({ page }) => {
    // Two searched flights, a reload and two Back flights, on the software rasterizer.
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    const title = page.getByTestId('hud-title');

    for (const name of ['Sirius', 'Proxima Centauri']) {
      await (await openSearch(page)).fill(name);
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
      await expect(title).toHaveText(name, { timeout: 30_000 });
    }
    // ?stars= survives beside the star, as every write merges into what the URL already holds.
    await expect(page).toHaveURL(/\/\?stars=4000&star=\d+$/);
    const proxima = page.url();

    await page.reload();
    await expect(title).toHaveText('Proxima Centauri', { timeout: 30_000 });

    await page.goBack();
    await expect(title).toHaveText('Sirius', { timeout: 30_000 });
    expect(page.url()).not.toBe(proxima);
    await page.goBack();
    await expect(page).toHaveURL(/\/\?stars=4000$/);
    await expect(backButtonLocator(page)).toHaveCount(0, { timeout: 30_000 });
  });

  test('a link to a star the catalogue does not hold opens on the neighbourhood, without an error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?stars=4000&star=999999999');

    await expect(page.getByTestId('hud-title')).toHaveText('Local Stars', { timeout: 30_000 });
    await expect(page).toHaveURL(/\/\?stars=4000$/);
    await expect(backButtonLocator(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('selecting a body result navigates straight to its detail route and shows real NASA data', async ({ page }) => {
    await page.goto('/?stars=4000');
    const searchInput = await openSearch(page);
    await searchInput.fill('Earth');

    const result = page.getByText('Earth', { exact: true });
    await expect(result).toBeVisible();
    await result.click();

    await expect(page).toHaveURL(/\/body\/earth$/);
    // The body-detail route is lazy-loaded; the first navigation to it in a dev-server session
    // can take a few seconds to bundle/compile, so this allows more time than the default 5s.
    await expect(page.getByRole('heading', { name: 'Earth' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Planet · Sol')).toBeVisible();
    await expect(page.getByText('Radius')).toBeVisible();
  });

  test('typing fewer than two characters shows no results, and Escape clears the query', async ({ page }) => {
    await page.goto('/?stars=4000');
    const searchInput = await openSearch(page);

    await searchInput.fill('E');
    await expect(page.getByTestId('search-results')).toHaveCount(0);

    await searchInput.fill('Earth');
    await expect(page.getByTestId('search-results').locator('li')).not.toHaveCount(0);

    await searchInput.press('Escape');
    await expect(searchInput).toHaveValue('');
    await expect(page.getByTestId('search-results')).toHaveCount(0);
  });
});
