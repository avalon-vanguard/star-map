import { expect, test } from '@playwright/test';

import { backButtonLocator } from './support/wait-for-back-button';

// A reduced star field throughout: this suite runs against a software rasterizer two orders of
// magnitude slower than a GPU, and what is under test is navigation and state rather than how
// fast the field rasterizes. See `starRenderBudgetFromUrl`.
test.describe('Galaxy view', () => {
  test('boots the app, initializes the 3D scene, and starts in the galaxy overview (no system controls shown)', async ({ page }) => {
    await page.goto('/?stars=4000');

    // Generously timed on purpose: this suite shares one software rasterizer, and the boot
    // it waits on is the slowest thing in it. The default five seconds is a coin toss
    // under a full parallel run.
    await expect(page.getByTestId('scene-canvas')).toBeVisible({ timeout: 30_000 });
    // The dock's tab strip is up before the scene finishes booting; the search is one tab in it.
    await expect(page.getByRole('tab', { name: 'Search' })).toBeVisible();
    await expect(backButtonLocator(page)).toHaveCount(0);
    // The readout panel's own title, not just the text anywhere on screen: the selected-object
    // banner across the top names the same thing, so a bare text match is ambiguous.
    await expect(page.getByTestId('hud-title')).toHaveText('Local Stars');
  });

  test('the scale ladder flies out to the whole Galaxy and back to the solar neighbourhood', async ({ page }) => {
    // Two multi-second camera flights, either side of a software-rendered scene bootstrap, add
    // up to more than the default per-test budget.
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    await expect(page.getByTestId('scene-canvas')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Milky Way' }).click();

    // The flight covers four orders of magnitude, and the readout only switches over once the
    // camera is far enough out for the Galaxy model to have taken over from the star field.
    await expect(page.getByText('Galactic Scale')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sagittarius A*')).toBeVisible();
    // At the outermost scale there is nowhere further out to go.
    await expect(page.getByRole('button', { name: 'Milky Way' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Solar Neighbourhood' }).click();
    await expect(page.getByTestId('hud-title')).toHaveText('Local Stars', { timeout: 15_000 });
  });

  test('a scale bar and labelled rings say how far things are, and follow the zoom', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    await expect(page.getByTestId('scene-canvas')).toBeVisible({ timeout: 30_000 });

    // The rings are distances from the Sun, the survey's own edge called out among them.
    await expect(page.getByText('Survey edge')).toBeVisible({ timeout: 30_000 });
    const scale = page.getByTestId('hud-scale');
    await expect(scale).toHaveAttribute('aria-label', /^Scale: [\d.]+ k?pc$/);
    const opening = await scale.getAttribute('aria-label');

    // Zooming in shortens the round length the bar stands for.
    await page.getByTestId('scene-canvas').hover();
    for (let notch = 0; notch < 10; notch++) {
      await page.mouse.wheel(0, -400);
    }
    await expect(scale).not.toHaveAttribute('aria-label', opening ?? '', { timeout: 15_000 });
  });
});
