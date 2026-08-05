# End-to-end tests (Playwright)

These tests run the real Angular dev server in a real Chromium browser, covering interactions
that unit/component tests (under `src/**/*.spec.ts`, run via `npm test`) can only approximate
under jsdom — most importantly the galaxy↔system **camera-flight transitions** (real WebGPU/
WebGL2 initialization + raycaster picking) and cross-view **search navigation**.

## Running

```bash
npm run e2e             # headless run against a freshly started dev server
npx playwright test --ui # interactive UI mode
npx playwright show-report
```

`playwright.config.ts` starts `npm run start -- --port=4300` automatically and waits for it to
respond before running the suite (`webServer.reuseExistingServer` is `true` outside CI, so an
already-running `ng serve` on port 4300 is reused instead of starting a second one). Port 4300
is used instead of the Angular CLI's conventional 4200 to avoid colliding with an unrelated
server a developer might already have running there.

## Notes

- The Sun (`Sol`) is always placed at the coordinate-system origin (`x=0,y=0,z=0`), which is
  exactly where the default galaxy-view camera looks. `camera-flight.spec.ts` relies on this to
  reliably click-select it by clicking the center of the canvas, without needing pixel-perfect
  knowledge of the star field's on-screen layout.
- Data (bootstrap fetch of `stars.bin`/`stars-index.json`/`bodies.json`/`exoplanets.json`/
  `deepsky.json`) loads asynchronously after the page loads, so tests poll (re-click/re-check)
  rather than assume the scene is interactive immediately after `page.goto()`.
- `deepsky.json` is the one dataset the scene treats as optional: it only feeds the decorative
  backdrop, so a failure to load it is logged and the star field comes up regardless.
