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
  reporter: 'html',
  // Well above Playwright's 5 s, which was a fair ceiling when the star catalogue was 820 kB and
  // is not now that the scheduled refresh has it at 5.4 MB and 447 410 rows: every one of these
  // tests boots that catalogue, and the suite boots several at once on a software rasterizer.
  // The heavy waits already carry their own longer timeouts; this is the same judgement applied
  // to the assertions that were left on the default. A ceiling costs nothing when it is not hit.
  expect: { timeout: 15_000 },
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
    command: 'npm run start -- --port=4300',
    url: 'http://localhost:4300',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
