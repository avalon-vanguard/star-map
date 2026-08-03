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
