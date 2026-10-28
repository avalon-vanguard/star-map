import { expect, test } from '@playwright/test';

import { openSearch } from './support/open-search';
import { backButtonLocator } from './support/wait-for-back-button';

test.describe('Search-driven navigation', () => {
  test('selecting a star result flies into that system and shows the back-to-galaxy control', async ({
    page,
  }) => {
    await page.goto('/?stars=4000');
    const searchInput = await openSearch(page);
    await searchInput.fill('Proxima Centauri');

    const result = page.getByRole('option', { name: /Proxima Centauri/ });
    await expect(result).toBeVisible();
    await result.click();

    // Selecting a result hands the dock straight back to the readout (before the flight even
    // starts): the thing to look at is now the scene, and the search panel folds away with it.
    await expect(page.getByRole('tab', { name: 'Readout' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(searchInput).toHaveCount(0);
    await expect(backButtonLocator(page)).toBeVisible({ timeout: 15_000 });
  });

  test('Enter in the field flies to the first result, and the arrows reach the list and come back', async ({
    page,
  }) => {
    await page.goto('/?stars=4000');
    const searchInput = await openSearch(page);
    await searchInput.fill('Sirius');

    // Waited for: the index loads with the catalogue, and Enter on an empty list picks nothing.
    const first = page.getByRole('listbox').getByRole('option').first();
    await expect(first).toContainText('Sirius');
    await expect(searchInput).toHaveAttribute('aria-expanded', 'true');
    await searchInput.press('ArrowDown');
    await expect(first).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('Sirius');

    await searchInput.press('Enter');
    await expect(page.getByTestId('hud-title')).toHaveText('Sirius', { timeout: 30_000 });
    await expect(backButtonLocator(page)).toBeVisible({ timeout: 15_000 });
  });

  test('the system flown into is in the URL, so a reload lands in it and Back retraces it', async ({
    page,
  }) => {
    // Two searched flights, a reload and two Back flights, on the software rasterizer.
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    const title = page.getByTestId('hud-title');

    for (const name of ['Sirius', 'Proxima Centauri']) {
      await (await openSearch(page)).fill(name);
      await page
        .getByRole('option', { name: new RegExp(`^${name}`) })
        .first()
        .click();
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

  test('a link to a star the catalogue does not hold opens on the neighbourhood, without an error', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?stars=4000&star=999999999');

    await expect(page.getByTestId('hud-title')).toHaveText('Local Stars', { timeout: 30_000 });
    await expect(page).toHaveURL(/\/\?stars=4000$/);
    await expect(backButtonLocator(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('selecting a body result navigates straight to its detail route and shows real NASA data', async ({
    page,
  }) => {
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

    // Back returns to the neighbourhood the search was made from, not to Earth's host system, and
    // leaves that entry as it was for the next Back.
    await page.goBack();
    await expect(page.getByTestId('hud-title')).toHaveText('Local Stars', { timeout: 30_000 });
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'Earth' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/\?stars=4000$/);
    await expect(page.getByTestId('hud-title')).toHaveText('Local Stars', { timeout: 30_000 });
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ]) {
    test.describe(`on a ${viewport.width}x${viewport.height} phone`, () => {
      test.use({ viewport, isMobile: true, hasTouch: true });

      test('every tab is whole on the strip, the page does not scroll sideways, and a star picked from Search is named on screen', async ({
        page,
      }) => {
        await page.goto('/?stars=4000');
        await expect(page.getByRole('tab')).toHaveCount(5);
        const strip = (await page.getByRole('tablist', { name: 'Dock' }).boundingBox())!;
        for (const tab of await page.getByRole('tab').all()) {
          const box = (await tab.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(strip.x - 0.5);
          expect(box.x + box.width).toBeLessThanOrEqual(strip.x + strip.width + 0.5);
        }
        // One line: on two, the rail ran into the scale bar under it.
        expect(
          (await page.getByRole('navigation', { name: 'Map scale' }).boundingBox())!.height,
        ).toBeLessThan(40);

        await page.getByRole('tab', { name: 'Search' }).tap();
        await page.getByPlaceholder('Search stars, planets, exoplanets…').fill('Sirius');
        await page
          .getByRole('option', { name: /^Sirius/ })
          .first()
          .tap();
        await expect(backButtonLocator(page)).toBeVisible({ timeout: 30_000 });
        // The sheet folds away on a phone, title and all: the nameplate is what names the star.
        await expect(page.getByTestId('hud-title')).toHaveCount(0);
        await expect(page.getByTestId('hud-banner')).toBeVisible();
        await expect(page.getByTestId('hud-banner')).toHaveText('Sirius');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
      });
    });
  }

  test('typing fewer than two characters shows no results, and Escape clears the query', async ({
    page,
  }) => {
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
