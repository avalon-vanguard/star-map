import { expect, test } from '@playwright/test';

import { backButtonLocator } from './support/wait-for-back-button';

// A reduced star field throughout: this suite runs against a software rasterizer two orders of
// magnitude slower than a GPU, and what is under test is navigation and state rather than how
// fast the field rasterizes. See `starRenderBudgetFromUrl`.
test.describe('Galaxy view', () => {
  test('boots the app, initializes the 3D scene, and starts in the galaxy overview (no system controls shown)', async ({ page }) => {
    await page.goto('/?stars=4000');

    await expect(page.getByTestId('scene-canvas')).toBeVisible();
    await expect(page.getByPlaceholder('Search stars, planets, exoplanets…')).toBeVisible();
    await expect(backButtonLocator(page)).toHaveCount(0);
    await expect(page.getByText('Local Stars')).toBeVisible();
  });

  test('the scale ladder flies out to the whole Galaxy and back to the solar neighbourhood', async ({ page }) => {
    // Two multi-second camera flights, either side of a software-rendered scene bootstrap, add
    // up to more than the default per-test budget.
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    await expect(page.getByTestId('scene-canvas')).toBeVisible();

    await page.getByRole('button', { name: 'Milky Way' }).click();

    // The flight covers four orders of magnitude, and the readout only switches over once the
    // camera is far enough out for the Galaxy model to have taken over from the star field.
    await expect(page.getByText('Galactic Scale')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sagittarius A*')).toBeVisible();
    // At the outermost scale there is nowhere further out to go.
    await expect(page.getByRole('button', { name: 'Milky Way' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Solar Neighbourhood' }).click();
    await expect(page.getByText('Local Stars')).toBeVisible({ timeout: 15_000 });
  });
});
