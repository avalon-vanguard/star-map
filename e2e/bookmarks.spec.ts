import { expect, test } from '@playwright/test';

import { openSearch } from './support/open-search';

test.describe('Bookmarks', () => {
  test('keeps a body, comes back to it in a later visit, and forgets it', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto('/body/earth');
    await expect(page.getByRole('heading', { name: 'Earth' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Keep Earth' }).click();
    await expect(page.getByRole('button', { name: 'Forget Earth' })).toHaveAttribute('aria-pressed', 'true');

    // A later visit, on a different page: kept places outlive the one they were kept from.
    await page.goto('/');
    // Generously timed on purpose: this suite shares one software rasterizer, and the boot
    // it waits on is the slowest thing in it. The default five seconds is a coin toss
    // under a full parallel run.
    await expect(page.getByTestId('scene-canvas')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Bookmarks' }).click();

    const kept = page.locator('#dock-panel-bookmarks li').filter({ hasText: 'Earth' });
    await expect(kept).toHaveCount(1);
    await kept.getByRole('button').first().click();

    // Choosing it goes there, which for a body is its page.
    await expect(page).toHaveURL(/\/body\/earth$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Earth' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Forget Earth' }).click();
    await expect(page.getByRole('button', { name: 'Keep Earth' })).toBeVisible();

    await page.getByRole('tab', { name: 'Bookmarks' }).click();
    await expect(page.locator('#dock-panel-bookmarks')).toContainText('Nothing kept yet');
  });

  test('keeps the system the view is inside, and flies back to it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?stars=4000');

    const searchInput = await openSearch(page);
    await searchInput.fill('Proxima Centauri');
    await page.getByRole('button', { name: /Proxima Centauri/ }).first().click();

    const readout = page.getByTestId('hud-title');
    await expect(readout).toHaveText('Proxima Centauri', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Keep Proxima Centauri' }).click();

    // Back out to the field, then return by what was kept rather than by searching again.
    await page.getByRole('button', { name: 'Solar Neighbourhood' }).click();
    await expect(readout).toHaveText('Local Stars', { timeout: 30_000 });

    await page.getByRole('tab', { name: 'Bookmarks' }).click();
    await page.locator('#dock-panel-bookmarks li').filter({ hasText: 'Proxima Centauri' }).getByRole('button').first().click();

    await expect(readout).toHaveText('Proxima Centauri', { timeout: 45_000 });
  });
});
