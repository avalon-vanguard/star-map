#!/usr/bin/env node
/**
 * driver.mjs — launch the star-map dev server and drive the running app in a real browser.
 *
 *   node .claude/skills/run-star-map/driver.mjs tour
 *   node .claude/skills/run-star-map/driver.mjs shot galaxy system
 *   node .claude/skills/run-star-map/driver.mjs probe
 *
 * Flags: --out=DIR (default /tmp/star-map-shots)  --stars=N (default 12000)
 *        --port=N (default 4300)  --keep-server  --headed
 *
 * Why this exists rather than `npm start` + look at a window: the container is headless, the
 * scene is WebGL rendered by a software rasterizer, and the app only reaches its interesting
 * states (system view, galactic scale) after multi-second camera flights that have to be waited
 * on rather than slept through. See SKILL.md.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect } from '@playwright/test';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const OUT = flag('out', '/tmp/star-map-shots');
const STARS = flag('stars', '12000');
const PORT = Number(flag('port', '4300'));
const BASE = `http://localhost:${PORT}`;
const command = argv.find((a) => !a.startsWith('--')) ?? 'tour';
const requested = argv.filter((a) => !a.startsWith('--')).slice(1);

/* ── Node selection ──────────────────────────────────────────────────────────────────────────
 * The container's default `node` is a hair below the floor the Angular CLI enforces, and the
 * satisfying build is NOT the one PATH finds first. Pick a binary that actually satisfies
 * package.json#engines rather than trusting `node`.                                          */

const satisfies = (version, range) => {
  const [maj, min, pat] = version.replace(/^v/, '').split('.').map(Number);
  return range.split('||').some((clause) => {
    const m = clause.trim().match(/^(\^|>=)?(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const [, op, cMaj, cMin, cPat] = [m[0], m[1], Number(m[2]), Number(m[3]), Number(m[4])];
    const atLeast = maj > cMaj || (maj === cMaj && (min > cMin || (min === cMin && pat >= cPat)));
    return op === '^' ? maj === cMaj && atLeast : atLeast;
  });
};

const pickNode = () => {
  const range = JSON.parse(readFileSync(`${REPO}/package.json`, 'utf8')).engines?.node ?? '';
  const candidates = [process.execPath, '/opt/node/bin/node', '/usr/local/bin/node', 'node'];
  for (const bin of candidates) {
    try {
      const v = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (v && satisfies(v.trim(), range)) return { bin, version: v.trim() };
    } catch {
      /* candidate absent — try the next */
    }
  }
  throw new Error(`no node satisfying engines "${range}" found; tried ${candidates.join(', ')}`);
};

/* ── Dev server ─────────────────────────────────────────────────────────────────────────────*/

const up = async () => {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

async function startServer() {
  if (await up()) {
    console.log(`dev server already up on ${BASE}`);
    return null;
  }
  const { bin, version } = pickNode();
  console.log(`starting dev server on ${BASE} (node ${version})`);
  const proc = spawn(bin, [`${REPO}/node_modules/.bin/ng`, 'serve', `--port=${PORT}`], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${dirname(bin)}:${process.env.PATH}` }
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`dev server exited with ${code}:\n${log.split('\n').slice(-12).join('\n')}`);
    }
  });

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await up()) {
      console.log('dev server ready');
      return proc;
    }
    if (proc.exitCode !== null) throw new Error(`dev server died:\n${log.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`dev server did not come up within 180s:\n${log.slice(-2000)}`);
}

/* ── Browser ────────────────────────────────────────────────────────────────────────────────*/

// The pinned @playwright/test does not necessarily match the browser revision baked into the
// container, so prefer the one that is actually on disk over the one Playwright expects.
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

const level = (page) => page.getByTestId('hud-current-level');
const title = (page) => page.getByTestId('hud-title');
const canvasOf = (page) => page.getByTestId('scene-canvas');

async function boot(page) {
  await page.goto(`${BASE}/?stars=${STARS}`);
  await expect(canvasOf(page)).toBeVisible({ timeout: 90_000 });
  await expect(title(page)).toHaveText('Local Stars', { timeout: 90_000 });
}

/** Screenshots are taken after a settle delay: a software-rasterized frame is usually still in
 *  flight when the DOM assertion that got us here has already passed. */
async function capture(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(2500);
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  console.log(`  ${path}  (level=${(await level(page).textContent())?.trim()})`);
}

/** Bootstrap (data fetch + raycaster wiring) finishes asynchronously, so clicking the canvas
 *  once usually lands before picking is live. Sol sits at the origin, dead centre of the
 *  default camera, so click-until-entered reliably enters the solar system. */
async function enterSystem(page) {
  const canvas = canvasOf(page);
  await expect
    .poll(
      async () => {
        if ((await level(page).textContent())?.trim() === 'System') return true;
        await canvas.click();
        return false;
      },
      { timeout: 90_000, intervals: [400] }
    )
    .toBe(true);
  await page.waitForTimeout(1500);
}

/** Zoom until the range readout drops to `auTarget`, so the inner planets fill the frame. */
async function zoomTo(page, auTarget) {
  const range = page.getByText(/\d+(\.\d+)? AU/);
  await page.mouse.move(800, 450);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(320);
    const au = Number(((await range.textContent().catch(() => null)) ?? '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(au) && au > 0 && au <= auTarget) return au;
  }
  return null;
}

const VIEWS = {
  field: async (page) => {
    await boot(page);
    await capture(page, '1-star-field');
  },
  galaxy: async (page) => {
    await boot(page);
    await page.getByRole('button', { name: 'Milky Way' }).click();
    await expect(page.getByText('Galactic Scale')).toBeVisible({ timeout: 90_000 });
    await capture(page, '2-galactic');
  },
  system: async (page) => {
    await boot(page);
    await enterSystem(page);
    await capture(page, '3-system-sol');
  },
  inner: async (page) => {
    await boot(page);
    await enterSystem(page);
    const au = await zoomTo(page, 6);
    console.log(`  zoomed to ${au ?? '?'} AU`);
    await capture(page, '4-system-inner');
  }
};

/* ── Commands ───────────────────────────────────────────────────────────────────────────────*/

/**
 * Dump the HUD's state as JSON instead of a picture — the fast way to check a label/HUD change
 * without eyeballing a screenshot. `probe system` reports the labels the overlay actually
 * placed, which is what most HUD regressions show up in.
 */
async function probe(page, view) {
  await boot(page);
  if (view === 'system' || view === 'inner') await enterSystem(page);
  if (view === 'inner') await zoomTo(page, 6);
  if (view === 'galaxy') {
    await page.getByRole('button', { name: 'Milky Way' }).click();
    await expect(page.getByText('Galactic Scale')).toBeVisible({ timeout: 90_000 });
  }
  await page.waitForTimeout(2000);

  // Labels are plain DOM in a CSS2D layer: .map-label > .map-label-name + .map-label-kind.
  // Neighbouring stars named from inside a system carry .map-label--ghost; they are reported
  // apart from the system's own bodies, since they are not in the system being probed.
  const all = await page.locator('.map-label').evaluateAll((nodes) =>
    nodes
      .filter((n) => n.offsetParent !== null)
      .map((n) => ({
        name: n.querySelector('.map-label-name')?.textContent?.trim() ?? '',
        kind: n.querySelector('.map-label-kind')?.textContent?.trim() ?? null,
        ghost: n.classList.contains('map-label--ghost')
      }))
  );
  const labels = all.filter((label) => !label.ghost).map(({ name, kind }) => ({ name, kind }));
  const neighbours = all.filter((label) => label.ghost).map(({ name, kind }) => ({ name, distance: kind }));
  console.log(
    JSON.stringify(
      {
        title: (await title(page).textContent())?.trim(),
        level: (await level(page).textContent())?.trim(),
        labelCount: labels.length,
        labels,
        ...(neighbours.length ? { neighbours } : {})
      },
      null,
      2
    )
  );
}

let server = null;
let failed = false;
try {
  server = await startServer();
  const browser = await chromium.launch({ executablePath, headless: !has('headed') });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

  if (command === 'probe') {
    await probe(page, requested[0] ?? 'field');
  } else {
    const names = command === 'shot' && requested.length ? requested : Object.keys(VIEWS);
    for (const name of names) {
      if (!VIEWS[name]) throw new Error(`unknown view "${name}" (have: ${Object.keys(VIEWS).join(', ')})`);
      console.log(`${name}:`);
      await VIEWS[name](page);
    }
  }
  await browser.close();
} catch (err) {
  failed = true;
  console.error(`FAILED: ${err.message}`);
} finally {
  if (server && !has('keep-server')) server.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
