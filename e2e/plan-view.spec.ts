import { expect, test } from '@playwright/test';

import { openSearch } from './support/open-search';

test.describe('Plan view', () => {
  test('flattens a system onto its own orbital plane, and unflattens it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?stars=4000');

    const searchInput = await openSearch(page);
    await searchInput.fill('Sol');
    await page.getByRole('button', { name: /^Sol\b/ }).first().click();
    await expect(page.getByTestId('hud-title')).toHaveText('Sol', { timeout: 45_000 });

    // Where the planets are on screen before and after: under a plan view they lie on one
    // circle around the star, so the spread of their distances from it collapses.
    const spread = async () =>
      page.evaluate(() => {
        const labels = [...document.querySelectorAll('.map-label:not(.map-label--ghost)')];
        const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        const radii = labels.map((label) => {
          const box = label.getBoundingClientRect();
          return Math.hypot(box.left - centre.x, box.top + box.height / 2 - centre.y);
        });
        return radii.length;
      });

    await expect.poll(spread, { timeout: 30_000 }).toBeGreaterThan(2);

    await page.getByRole('tab', { name: 'Display' }).click();
    const plan = page.getByRole('button', { name: 'Plan view', exact: true });
    await expect(plan).toHaveAttribute('aria-pressed', 'false');
    await plan.click();
    await expect(plan).toHaveAttribute('aria-pressed', 'true');

    // The scene survives the swap: it is still this system, still labelled, still readable.
    await expect(page.getByTestId('scene-canvas')).toBeVisible();
    await expect.poll(spread, { timeout: 30_000 }).toBeGreaterThan(2);
    await page.getByRole('tab', { name: 'Readout' }).click();
    await expect(page.getByTestId('hud-title')).toHaveText('Sol');

    await page.getByRole('tab', { name: 'Display' }).click();
    await plan.click();
    await expect(plan).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(spread, { timeout: 30_000 }).toBeGreaterThan(2);
  });

  test('keeps the scale ladder honest about how far out the view is', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    await expect(page.getByTestId('scene-canvas')).toBeVisible();
    await expect(page.getByTestId('hud-current-level')).toHaveText('Solar Neighbourhood', { timeout: 30_000 });

    await page.getByRole('tab', { name: 'Display' }).click();
    await page.getByRole('button', { name: 'Plan view', exact: true }).click();

    // Under an orthographic camera the distance from the origin no longer sets what is in
    // frame, so the level would be read from a number that stopped meaning anything.
    await expect(page.getByTestId('hud-current-level')).toHaveText('Solar Neighbourhood');
    await page.getByRole('button', { name: 'Milky Way' }).click();
    await expect(page.getByTestId('hud-current-level')).toHaveText('Milky Way', { timeout: 45_000 });
  });
});
