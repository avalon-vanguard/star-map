import { expect, test } from '@playwright/test';

import { backButtonLocator, clickCanvasUntilSystemEntered } from './support/wait-for-back-button';

test.describe('Camera-flight transitions (click-to-select)', () => {
  test('clicking the star at the view center flies into its system, and the back button flies back out to the galaxy overview', async ({ page }) => {
    await page.goto('/');

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
