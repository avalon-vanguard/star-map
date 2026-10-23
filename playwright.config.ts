import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests that exercise the app in a real browser: search-driven navigation and the
 * galaxy↔system camera-flight transitions (raycasting, WebGPU/WebGL2 init, DOM state) that
 * unit/component tests can only approximate under jsdom. See `e2e/README.md`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One browser at a time in CI: the VPS's `big` runner has 2.5 CPUs for `ng serve` and Chromium's
  // software rasterizer, and two browsers there timed out 6 of the 17 tests (Gitea run 407).
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  // Well above Playwright's 5 s, which was a fair ceiling when the star catalogue was 820 kB and
  // is not now that the scheduled refresh has it at 5.4 MB and 447 410 rows: every one of these
  // tests boots that catalogue, and the suite boots several at once on a software rasterizer.
  // The heavy waits already carry their own longer timeouts; this is the same judgement applied
  // to the assertions that were left on the default. A ceiling costs nothing when it is not hit.
  expect: { timeout: 15_000 },
  // The test itself had kept Playwright's 30 s. On the `big` runner a frame of the scene takes
  // about 2 s (Gitea run 1164's traces), and every locator step waits at least one frame, so a
  // dozen steps use the whole budget before any assertion is slow: the phone tests timed out
  // while waiting for tabs that were already there.
  timeout: process.env.CI ? 90_000 : 30_000,
  use: {
    baseURL: 'http://localhost:4300',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    // Uses a dedicated port (rather than the Angular CLI's conventional 4200) so this never
    // collides with an unrelated `ng serve`/other server a developer already has running.
    // In CI the production build: minified, without the dev build's source maps, it leaves the
    // runner's CPUs to Chromium's software rasterizer; on the dev build 4 of 17 tests still timed
    // out with one browser (Gitea run 417).
    command: `npm run start -- --port=4300${process.env.CI ? ' --configuration=production' : ''}`,
    url: 'http://localhost:4300',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
