---
name: run-star-map
description: Build, launch, run, drive, and screenshot the star-map Angular app in this container. Use when asked to run or start the app, take a screenshot of the map or HUD, check a UI change in a real browser, or run the unit/e2e test suites.
---

# Running star-map

An Angular 3D star map (three.js, WebGPU renderer falling back to WebGL2). There is no GPU here,
so the scene is software-rasterized and slow — but it does run, and it screenshots.

Drive it with the committed driver, which owns the dev server, the browser, and the camera flights:

```
.claude/skills/run-star-map/driver.mjs
```

All paths below are relative to the repo root.

## Prerequisites

Two container quirks have to be handled first. **Both are one-liners, and both are silent
footguns if skipped** — see Gotchas for why.

**1. Node.** The default `node` on `PATH` is *below* the floor the Angular CLI enforces. A
satisfying build is at `/opt/node`. The driver picks it automatically; anything you run by hand
needs the prefix:

```bash
node -v                        # v22.22.2  ← too old, ng refuses to start
/opt/node/bin/node -v          # v22.23.2  ← use this
export PATH=/opt/node/bin:$PATH
```

**2. Playwright browser.** The pinned `@playwright/test` (1.62.1) wants Chromium revision 1234;
this container ships 1194, under a different internal layout. Do **not** run
`npx playwright install` (the environment blocks browser downloads). Shim the expected path
instead — needed only for `npm run e2e`, not for the driver:

```bash
mkdir -p /opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64
ln -sfn /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
        /opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
touch /opt/pw-browsers/chromium_headless_shell-1234/INSTALLATION_COMPLETE
```

## Install

```bash
PATH=/opt/node/bin:$PATH npm ci        # ~25s
```

## Run (agent path) — the driver

Takes screenshots of the app at each scale. Starts the dev server on port 4300 if one isn't
already up, and stops it on exit.

```bash
node .claude/skills/run-star-map/driver.mjs tour
```

```
starting dev server on http://localhost:4300 (node v22.23.2)
dev server ready
field:
  /tmp/star-map-shots/1-star-field.png  (level=Solar Neighbourhood)
galaxy:
  /tmp/star-map-shots/2-galactic.png  (level=Milky Way)
system:
  /tmp/star-map-shots/3-system-sol.png  (level=System)
inner:
  zoomed to 5.53 AU
  /tmp/star-map-shots/4-system-inner.png  (level=System)
```

`tour` takes **~3m20s** — most of it camera flights and software rasterization. For one view:

```bash
node .claude/skills/run-star-map/driver.mjs shot galaxy          # ~1m
node .claude/skills/run-star-map/driver.mjs shot field system
```

| View | What it shows |
|---|---|
| `field` | Solar-neighbourhood star field — the default landing view |
| `galaxy` | Galactic scale: arms, bar, Sol's position |
| `system` | Sol at ~120 AU, outer planets labelled |
| `inner` | Sol zoomed to <6 AU, inner four planets labelled |

**Look at the PNG you produced.** A black frame means the scene never initialized — that is a
failure, not a dark theme.

Flags: `--out=DIR` (default `/tmp/star-map-shots`), `--stars=N` (default 12000), `--port=N`
(default 4300), `--keep-server`, `--headed`.

### Checking HUD state without screenshots

Faster than eyeballing a picture, and the right tool for label/HUD changes:

```bash
node .claude/skills/run-star-map/driver.mjs probe inner
```

```json
{
  "title": "Sol",
  "level": "System",
  "labelCount": 4,
  "labels": [
    { "name": "Mars", "kind": "Planet" },
    { "name": "Earth", "kind": "Planet" },
    { "name": "Mercury", "kind": "Planet" },
    { "name": "Venus", "kind": "Planet" }
  ]
}
```

`probe` accepts the same four view names. Labels are read from the CSS2D layer
(`.map-label` > `.map-label-name` + `.map-label-kind`).

## Run (human path)

```bash
PATH=/opt/node/bin:$PATH npm start -- --port=4300
```

Serves on <http://localhost:4300>. Useless headless on its own — there is no display to look at.
Use it only when you want a long-lived server for the driver to attach to (the driver reuses an
already-running server and leaves it alone on exit).

## Test

```bash
PATH=/opt/node/bin:$PATH npm test                    # 496 tests, 28 files, ~5s
PATH=/opt/node/bin:$PATH npm run build               # ~9s
PATH=/opt/node/bin:$PATH npm run etl:typecheck
PATH=/opt/node/bin:$PATH npm run e2e:typecheck
PATH=/opt/node/bin:$PATH npm run e2e -- --workers=1  # 6 tests, ~2.3m
```

`--workers=1` on the e2e suite is **not optional here** — see Gotchas.

## Gotchas

- **The wrong Node is first on `PATH`.** `/opt/node22` is v22.22.2; `/opt/node` is v22.23.2.
  `PATH` finds the *older* one, and `package.json#engines` requires `^22.22.3`. `ng serve` then
  dies with "Node.js version v22.22.2 detected" and nothing else. The names invert what you'd
  guess — `/opt/node` is newer than `/opt/node22`.
- **`npm run e2e` fails at full parallelism**, passing 4 of 6. The two camera-flight specs time
  out when four browsers share a software rasterizer. The same specs pass alone and pass with
  `--workers=1`. It is CPU contention, not a broken test — don't "fix" the specs.
- **Never stop the dev server with `pkill -f`.** It matches against every process's full command
  line — including the shell running your own `pkill`, which then kills itself (exit 144). Narrowing
  the pattern does not save you, and neither does the `[n]g` bracket trick: the match is against the
  *whole* command line, so a literal `ng serve` anywhere else in it — inside an `echo`, a comment, a
  later `pgrep` — re-arms the self-match. Kill by port instead, which does no pattern matching at all:

  ```bash
  fuser -k 4300/tcp
  ```

  Or just let the driver clean up after itself, which it does unless you pass `--keep-server`.
- **The star count must be cut for anything interactive.** The full catalogue is 68 388 stars and
  runs at roughly 1 fps here. `?stars=N` overrides it; the driver defaults to 12 000.
- **One canvas click is not enough to enter a system.** Bootstrap (data fetch + raycaster wiring)
  finishes asynchronously after load, so an early click hits nothing. The driver polls
  click-until-`hud-current-level`-reads-`System`. Sol is at the origin, dead centre of the default
  camera, so the centre click is what reliably works.
- **Screenshots need a settle delay.** A DOM assertion passing does not mean the frame is drawn;
  the driver waits 2.5s before every capture. Without it you get half-rendered scenes.
- **At 120 AU the inner planets have no labels.** They are inside the centre reticle, collapsed to
  a few pixels, and correctly suppressed. This is not a regression — zoom below ~6 AU (the `inner`
  view) to see Mercury/Venus/Earth/Mars labelled.
- **Port 4300, not Angular's usual 4200** — the project's own convention, set in
  `playwright.config.ts` so it never collides with an unrelated `ng serve`.
- **Don't write driver scripts in `.ts` outside the repo.** `tsx` compiles a bare `.ts` as CJS
  ("Top-level await is currently not supported with the cjs output format"), and a script outside
  the repo can't resolve `@playwright/test` at all. The driver is `.mjs` inside the repo for both
  reasons.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Node.js version v22.22.2 detected. The Angular CLI requires...` | `export PATH=/opt/node/bin:$PATH` |
| `browserType.launch: Executable doesn't exist at .../chromium_headless_shell-1234/...` | Apply the browser shim in Prerequisites. Do **not** run `npx playwright install`. |
| e2e: 2 specs time out on camera flights | Add `-- --workers=1` |
| Your shell exits with code 144 while cleaning up | A `pkill -f` matched your own command line. Use `fuser -k 4300/tcp`. |
| Screenshot is entirely black | Scene never initialized — check the driver's `[pageerror]` lines. |
| `Top-level await is currently not supported with the "cjs" output format` | Name the script `.mjs` (or `.mts`) and keep it inside the repo. |
| Driver hangs at "starting dev server" | Another server holds port 4300: `fuser -k 4300/tcp`, or pass `--port=4301`. |
