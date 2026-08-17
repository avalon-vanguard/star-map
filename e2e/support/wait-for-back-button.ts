import { expect, Locator, Page } from '@playwright/test';

/**
 * The HUD's scale ladder marks the level the view is currently at, and offers the others as
 * buttons. `NavigationStore.viewLevel()` becomes `'system'` only once a full galaxy-to-system
 * camera-flight transition has settled, so that marker reading "System" is the signal that the
 * transition is done.
 */
export function currentLevelLocator(page: Page): Locator {
  return page.getByTestId('hud-current-level');
}

/** The ladder entry that takes the view back out of a system, once there is one to leave. */
export function backButtonLocator(page: Page): Locator {
  return page.getByRole('button', { name: 'Solar Neighbourhood' });
}

/**
 * Bootstrap (data fetch + raycaster wiring) finishes asynchronously after `page.goto()`, so this
 * repeatedly clicks the canvas — re-checking first, so it never clicks a system-view body marker
 * by accident once the transition has already completed — until the view reports it is in a
 * system.
 */
export async function clickCanvasUntilSystemEntered(page: Page, canvas: Locator, backButton: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await currentLevelLocator(page).textContent())?.trim() === 'System') {
          return true;
        }
        await canvas.click();
        return false;
      },
      { timeout: 15_000, intervals: [300] }
    )
    .toBe(true);
  await expect(backButton).toBeVisible();
}
