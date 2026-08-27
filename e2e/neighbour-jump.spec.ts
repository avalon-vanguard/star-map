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
    // there. Whichever one the ring names, not a star named here: the catalogue is refreshed on
    // a schedule, and a refresh reorders which four are nearest — a hand-picked name made this a
    // test of the catalogue's contents rather than of the ring. Which of them survives the
    // declutter is a property of the view, so the first is as good as any.
    const neighbour = page.getByRole('button', { name: /^Go to .+ pc away$/ }).first();
    await expect(neighbour).toBeVisible({ timeout: 30_000 });
    const label = (await neighbour.getAttribute('aria-label'))!;
    const name = /^Go to (.+), [\d.]+ pc away$/.exec(label)![1];

    // Clicked by the name just read rather than through `neighbour`, which re-resolves `.first()`
    // and could land on a different star if the label pass reorders the ring in between.
    await page.getByRole('button', { name: label, exact: true }).click();

    await expect(readout).toHaveText(name, { timeout: 45_000 });
    // And from there the walk goes on: the new system names its own neighbours. Which ones is
    // not asserted — neighbours sharing a bearing are decluttered, so which of them survives is
    // a property of the view, not a fact about the catalogue.
    await expect(page.locator('.map-label--ghost')).not.toHaveCount(0, { timeout: 30_000 });
  });
});
