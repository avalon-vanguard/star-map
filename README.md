# star-map

An interactive 3D star map in the spirit of Star Citizen's in-game starmap, but populated with
real astronomical data instead of fictional systems. Browse the solar neighbourhood, fly into a
star's system to see its planets on their real orbits, and drill into a single body for the
NASA figures behind it.

This repo also hosts a small Claude Code plugin marketplace — see [Plugins](#plugins) below.

## Running it

```bash
npm install
npm start          # dev server on http://localhost:4200
npm run build      # production bundle into dist/
```

Requires the Node version in `package.json`'s Angular toolchain range (Node 22.22.3+ or 24.15+).

```bash
npm test               # unit/component tests (Vitest, jsdom)
npm run e2e            # end-to-end tests (Playwright + Chromium) — see e2e/README.md
npm run etl            # refresh the astronomical datasets — see below
npm run etl:typecheck  # type-check the ETL scripts (they build separately from the app)
npm run e2e:typecheck
```

## What's in it

**Galaxy view** — every HYG-catalogue star within 50 parsecs as instanced camera-facing
billboards, positioned from real RA/Dec/parallax, coloured by spectral index and sized by
magnitude. Names label the stars nearest the camera. Behind them sits a backdrop of notable
deep-sky objects and a Milky Way panorama.

**System view** — selecting a star flies the camera continuously into its system rather than
cutting to a new scene. The Sun gets the real solar-system bodies from JPL Horizons; other
stars get their confirmed exoplanets. Orbits are drawn as ellipses and bodies are propagated
along them by a Kepler solver against the current epoch.

**Body detail** — a dedicated close-up scene and info panel for one planet, moon or exoplanet,
with real photography where NASA/ESA/USGS imagery exists.

**Search** — name search across stars, solar-system bodies and exoplanets, navigating to the
same place an in-scene click would.

### Architecture notes

- **Rendering** runs on Three.js `WebGPURenderer`, which falls back to a WebGL2 backend
  automatically. The render loop runs outside Angular's change detection.
- **Stars are billboards, not points.** The WebGPU backend caps point primitives at a single
  pixel, so a points cloud renders every star as an identical dot regardless of magnitude. The
  star field is instanced quads on a `SpriteNodeMaterial` instead, which behaves the same on
  both backends. Their size is angular rather than world-space — real stars are unresolvable
  point sources, so apparent size should follow brightness, not distance.
- **One reference frame, from three sources.** HYG gives star positions in equatorial J2000.
  JPL Horizons reports orbital elements against the ecliptic, tilted 23.4° away. The Exoplanet
  Archive measures inclination from the *plane of the sky* — perpendicular to our line of sight
  to each host star, which is why transiting planets cluster at 90°. Each set of elements is
  rotated from its own reference plane into the scene's equatorial frame, so a direction means
  the same thing everywhere. Systems are still presented face-on — by placing the camera
  relative to the orbital plane rather than by rotating the world into a convenient pose.
- **Two coordinate scales.** The galaxy view works in parsecs and the system view in AU —
  about eight orders of magnitude apart, which wrecks float precision if rendered in one unit
  space. The camera rig recentres the active star to the origin ("floating origin") and swaps
  the unit scale and near/far planes at the transition point.
- **No backend.** Every dataset is baked at build time into `src/assets/data/` and served as a
  static asset. Nothing queries an astronomy API at runtime.

## Data pipeline

`npm run etl` runs `tools/etl/build.ts`, which fetches each source, writes the static assets,
then validates the combined output. Raw responses are cached under `tools/etl/.cache/`, so
re-runs are cheap and offline-friendly; set `ETL_FORCE_REFRESH=1` to bypass the cache.

| Script | Source | Output |
| --- | --- | --- |
| `fetchStars.ts` | HYG database (Hipparcos/Yale/Gliese) | `stars.bin`, `stars-index.json` |
| `fetchSolarSystem.ts` | JPL Horizons / SSD | `bodies.json` |
| `fetchExoplanets.ts` | NASA Exoplanet Archive (TAP) | `exoplanets.json` |
| `fetchDeepSky.ts` | OpenNGC | `deepsky.json` |

Star positions ship as a packed `Float32Array` (`stars.bin`) rather than JSON to keep the
initial payload and parse cost down; `stars-index.json` carries everything else in the same
order.

`ETL_STAR_DISTANCE_PC` (default `50`) sets the star-field distance cutoff.

### On deep-sky distances

OpenNGC publishes no distance column, so distance has to be inferred — and the inference fails
for precisely the best-known objects. M31, M33 and M42 are Local Group members whose redshift
is negative or absent, and the catalogue's parallax for a galaxy comes from a cross-matched
foreground star (it lists 6 mas for M31, implying 167 pc for something 780,000 pc away).

So deep-sky records store a **unit direction** on the celestial sphere rather than a position:
the line of sight is always known precisely, and the objects are drawn as a fixed-radius
backdrop shell where true distance would be unusable anyway. `distancePc` is optional metadata,
derived from parallax for galactic objects or the Hubble law for genuinely distant galaxies,
and left `null` — with its `distanceMethod` — whenever neither is trustworthy. Roughly 330 of
the 463 cataloged objects get a distance; the rest honestly report none.

## Layout

```
src/app/
  core/engine/          Three.js renderer, render loop, resize
  core/data/            static-asset loading and caching
  features/galaxy-system/  shared galaxy+system scene, camera rig, star field,
                           deep-sky backdrop, orbits, labels
  features/body-detail/    close-up scene and info panel
  features/search/         name search across every dataset
  shared/astro/         coordinates, Kepler propagator, deep-sky classification
  shared/models/        record contracts shared by the app and the ETL
  shared/rendering/     skybox, glow sprites, texture catalog
  shared/state/         navigation store (Angular signals)
tools/etl/              build-time data pipeline
e2e/                    Playwright end-to-end tests
```

The design document behind all of this is `.junie/plans/nasa-star-map.md`.

## Plugins

This repo doubles as a Claude Code plugin marketplace. Adding it and installing a plugin
defaults to **user scope**, meaning the plugin becomes available in *every* project on your
machine, not just the one you happen to be in:

```bash
/plugin marketplace add avalon-vanguard/star-map
/plugin install caveman@star-map
```

Scope can be overridden at install time if you want it tied to a single repo instead:

```bash
# Shared with collaborators via that repo's .claude/settings.json
/plugin install caveman@star-map --scope project

# Just for you, in that one repo only (gitignored)
/plugin install caveman@star-map --scope local
```

See [Claude Code plugin installation scopes](https://code.claude.com/docs/en/plugins-reference)
for details on `user` / `project` / `local` scope.

- **caveman** — `/cs:caveman` ultra-compressed communication mode.
  - Command: [`commands/cs/caveman.md`](commands/cs/caveman.md)
  - Agent: [`agents/cs-caveman-mode.md`](agents/cs-caveman-mode.md)
  - Skill: [`skills/caveman/SKILL.md`](skills/caveman/SKILL.md)

## Data credits

Star catalogue: [HYG database](https://github.com/astronexus/HYG-Database) (Hipparcos, Yale
Bright Star, Gliese). Solar-system ephemerides: NASA/JPL Horizons. Exoplanets: NASA Exoplanet
Archive. Deep-sky objects: [OpenNGC](https://github.com/mattiaverga/OpenNGC). Body and skybox
imagery: NASA/JPL/USGS public domain and Solar System Scope (CC BY 4.0) — per-file provenance
is recorded in `src/app/shared/rendering/texture-catalog.ts`.
