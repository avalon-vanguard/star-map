import { expect, test } from '@playwright/test';

test.describe('Route plotting', () => {
  test('chains one star to another through the crossings a chosen range allows', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    await expect(page.getByTestId('scene-canvas')).toBeVisible();

    await page.getByRole('tab', { name: 'Routes' }).click();

    // Sirius is 2.64 pc from the Sun, so the default 3 pc range crosses it in one.
    await page.locator('#route-from').fill('Sol');
    const departure = page.locator('#dock-panel-routes ul li button').first();
    await expect(departure).toBeVisible({ timeout: 30_000 });
    await departure.click();

    await page.locator('#route-to').fill('Sirius');
    const destination = page.locator('#dock-panel-routes ul li button').first();
    await expect(destination).toBeVisible();
    await destination.click();

    await page.getByRole('button', { name: 'Plot route' }).click();

    await expect(page.getByTestId('route-summary')).toHaveText(/1 jump · 2\.6\d pc/);
    // The chain itself, departure first, each step a way to fly there.
    const steps = page.getByTestId('route-steps').getByRole('button');
    await expect(steps).toHaveCount(2);
    await expect(steps.first()).toContainText('Sol');
    await expect(steps.last()).toContainText('Sirius');
  });

  test('says what range a crossing would need, rather than only that there is none', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/?stars=4000');
    await expect(page.getByTestId('scene-canvas')).toBeVisible();

    await page.getByRole('tab', { name: 'Routes' }).click();
    await page.locator('#route-from').fill('Sol');
    const departure = page.locator('#dock-panel-routes ul li button').first();
    await expect(departure).toBeVisible({ timeout: 30_000 });
    await departure.click();

    // Narrowed until nothing the catalogue holds is within reach of the Sun: its nearest
    // neighbour is 1.30 pc away, so half a parsec strands it.
    await page.locator('#route-range').fill('0.5');
    await page.locator('#route-to').fill('Sirius');
    const destination = page.locator('#dock-panel-routes ul li button').first();
    await expect(destination).toBeVisible();
    await destination.click();
    await page.getByRole('button', { name: 'Plot route' }).click();

    const summary = page.getByTestId('route-summary');
    await expect(summary).toContainText('No route at this range', { timeout: 30_000 });
    // And the answer, not just the refusal: the range that would open one, offered as a control.
    const raise = summary.getByRole('button');
    await expect(raise).toContainText(/pc would reach/);
    await raise.click();

    await expect(page.getByTestId('route-summary')).toContainText(/jump/, { timeout: 30_000 });
  });
});
