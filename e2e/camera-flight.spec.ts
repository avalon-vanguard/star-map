import { expect, test } from '@playwright/test';

import { backButtonLocator, clickCanvasUntilSystemEntered } from './support/wait-for-back-button';

test.describe('Camera-flight transitions (click-to-select)', () => {
  test('clicking the star at the view center flies into its system, and the back button flies back out to the galaxy overview', async ({ page }) => {
    // A software-rendered bootstrap, a click-until-selected poll of up to 15 seconds, and two
    // multi-second camera flights, all while the other specs share the same CPU. The default
    // per-test budget covers that only just, and stopped covering it once a second flight-heavy
    // spec started running alongside this one.
    test.setTimeout(90_000);
    // A reduced star field, because this suite runs against a software rasterizer two orders of
    // magnitude slower than a GPU, and what is under test here is the navigation state machine
    // rather than how fast 68388 sprites rasterize. See `starRenderBudgetFromUrl`.
    await page.goto('/?stars=4000');

    const canvas = page.getByTestId('scene-canvas');
    await expect(canvas).toBeVisible();
    const backButton = backButtonLocator(page);
    await expect(backButton).toHaveCount(0);

    // Sol sits at the coordinate system's origin, exactly where the default galaxy-view camera
    // looks, so clicking the canvas center reliably hits it once bootstrap/picking are ready.
    await clickCanvasUntilSystemEntered(page, canvas, backButton);

    await backButton.click();
    await expect(backButton).toHaveCount(0, { timeout: 15_000 });
  });
});
