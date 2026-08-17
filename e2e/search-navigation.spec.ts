import { expect, test } from '@playwright/test';

import { backButtonLocator } from './support/wait-for-back-button';

test.describe('Search-driven navigation', () => {
  test('selecting a star result flies into that system and shows the back-to-galaxy control', async ({ page }) => {
    await page.goto('/?stars=4000');
    const searchInput = page.getByPlaceholder('Search stars, planets, exoplanets…');
    await searchInput.fill('Proxima Centauri');

    const result = page.getByRole('button', { name: /Proxima Centauri/ });
    await expect(result).toBeVisible();
    await result.click();

    // Selecting a result clears the search query immediately (before the flight even starts).
    await expect(searchInput).toHaveValue('');
    await expect(backButtonLocator(page)).toBeVisible({ timeout: 15_000 });
  });

  test('selecting a body result navigates straight to its detail route and shows real NASA data', async ({ page }) => {
    await page.goto('/?stars=4000');
    const searchInput = page.getByPlaceholder('Search stars, planets, exoplanets…');
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
    const searchInput = page.getByPlaceholder('Search stars, planets, exoplanets…');

    await searchInput.fill('E');
    await expect(page.getByTestId('search-results')).toHaveCount(0);

    await searchInput.fill('Earth');
    await expect(page.getByTestId('search-results').locator('li')).not.toHaveCount(0);

    await searchInput.press('Escape');
    await expect(searchInput).toHaveValue('');
    await expect(page.getByTestId('search-results')).toHaveCount(0);
  });
});
