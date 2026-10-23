import { expect, test } from '@playwright/test';

import { backButtonLocator } from './support/wait-for-back-button';

// A reduced star field throughout: this suite runs against a software rasterizer two orders of
// magnitude slower than a GPU, and what is under test is navigation and state rather than how
// fast the field rasterizes. See `starRenderBudgetFromUrl`.
test.describe('Galaxy view', () => {
  test('boots the app, initializes the 3D scene, and starts in the galaxy overview (no system controls shown)', async ({
    page,
  }) => {
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

  test('the scale ladder flies out to the whole Galaxy and back to the solar neighbourhood', async ({
    page,
  }) => {
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

  test('a scale bar and labelled rings say how far things are, and follow the zoom', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    await expect(page.getByTestId('scene-canvas')).toBeVisible({ timeout: 30_000 });

    // The rings are distances from the Sun, the survey's own edge called out among them.
    await expect(page.getByText('Survey edge')).toBeVisible({ timeout: 30_000 });
    const rung = page
      .locator('.map-label--ghost .map-label-name')
      .filter({ hasText: /^\d+ pc$/ })
      .first();
    await expect(rung).toBeVisible({ timeout: 30_000 });
    // On a plate of the void, 80% opaque, so the label reads over a bright field as over black.
    await expect(rung).toHaveCSS('background-color', /^oklab\(0\.12\d* .* \/ 0\.8\)$/);
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

  test('a star’s name is a Tab away from the map and flies there on Enter, and the pointer still reaches the map through it', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    await expect(page.getByTestId('scene-canvas')).toBeVisible({ timeout: 30_000 });
    const label = page.locator('button.map-label:not(.map-label--ghost):visible').first();
    await expect(label).toHaveAttribute('aria-label', /^Go to .+, (Star|System)$/, {
      timeout: 30_000,
    });

    // The wheel and a drag that start on a name still move the map, as they did when no name
    // could be pressed.
    const box = (await label.boundingBox())!;
    // An 11 px name at the labels' 1.15 line height over a 10 px kind set solid, as tall as a
    // name that is not a button: the label pass keeps names a 22 px row apart.
    expect(box.height).toBeLessThan(23);
    // The kind line at the HUD labels' 10 px, not the 8 px it was the quietest text on screen at.
    expect(
      await label.locator('.map-label-kind').evaluate((kind) => getComputedStyle(kind).fontSize),
    ).toBe('10px');
    const under = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-testid'),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(under).toBe('scene-canvas');

    await page.getByTestId('scene-canvas').focus();
    await page.keyboard.press('Tab');
    await expect(label).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]star=\d+/, { timeout: 30_000 });
  });
});
