import { expect, Locator, Page } from '@playwright/test';

/**
 * The "Galaxy" back button is only rendered while `NavigationStore.viewLevel() === 'system'`,
 * which becomes true only once a full galaxy-to-system camera-flight transition has settled.
 * Bootstrap (data fetch + raycaster wiring) finishes asynchronously after `page.goto()`, so
 * this repeatedly clicks the canvas (re-checking first, so it never clicks a system-view body
 * marker by accident once the transition has already completed) until the button appears.
 */
export function backButtonLocator(page: Page): Locator {
  return page.getByRole('button', { name: 'Galaxy' });
}

export async function clickCanvasUntilSystemEntered(page: Page, canvas: Locator, backButton: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        if (await backButton.isVisible()) {
          return true;
        }
        await canvas.click();
        return false;
      },
      { timeout: 15_000, intervals: [300] }
    )
    .toBe(true);
}
