import { expect, test } from '@playwright/test';

import { openSearch } from './support/open-search';

test.describe('Neighbour jump', () => {
  test('a neighbour named from inside one system flies into that one', async ({ page }) => {
    // Two full camera flights on a software rasterizer shared with the rest of the suite: into
    // Sol, then out and into the star its label names. See the same note on camera-flight.
    test.setTimeout(120_000);
    await page.goto('/?stars=4000');

    const searchInput = await openSearch(page);
    await searchInput.fill('Sol');
    await page.getByRole('button', { name: /^Sol\b/ }).first().click();

    const readout = page.getByTestId('hud-title');
    await expect(readout).toHaveText('Sol', { timeout: 30_000 });

    // Its nearest neighbours are named around the edge of the view; each is a button that flies
    // there. Barnard's Star rather than the Alpha Centauri trio, whose three members share one
    // bearing and so are decluttered down to whichever the label pass reaches first.
    const neighbour = page.getByRole('button', { name: /Barnard's Star/ });
    await expect(neighbour).toBeVisible({ timeout: 30_000 });
    await neighbour.click();

    await expect(readout).toHaveText("Barnard's Star", { timeout: 45_000 });
    // And from there the walk goes on: the new system names its own neighbours. Which ones is
    // not asserted — several of Barnard's nearest share a bearing, so which of them survives
    // the declutter is a property of the view, not a fact about the catalogue.
    await expect(page.locator('.map-label--ghost')).not.toHaveCount(0, { timeout: 30_000 });
  });
});
