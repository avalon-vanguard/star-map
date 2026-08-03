import { expect, test } from '@playwright/test';

test.describe('Galaxy view', () => {
  test('boots the app, initializes the 3D scene, and starts in the galaxy overview (no system controls shown)', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('scene-canvas')).toBeVisible();
    await expect(page.getByPlaceholder('Search stars, planets, exoplanets…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Galaxy' })).toHaveCount(0);
  });
});
