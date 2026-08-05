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
magnitude. A polar grid in the galactic plane runs under them with a drop line from each of the
Sun's nearest neighbours, and names label the stars nearest whatever the camera is looking at.
Behind them sits a backdrop of notable deep-sky objects and a Milky Way panorama.

**Galactic view** — keep pulling back and the neighbourhood becomes a point inside the Milky
Way: the bar and bulge, five spiral arms, the disc and a thin halo, with the arms and the
galactic centre named. It is the same parsec-scale space as the galaxy view, crossfaded by
camera distance rather than switched, so the Sun stays where it really is — 8.18 kpc out, on the
Orion Spur, between the Sagittarius and Perseus arms. See "On the Galaxy model" below for what
in it is measured and what is not.

**System view** — selecting a star flies the camera continuously into its system rather than
cutting to a new scene. The Sun gets the real solar-system bodies from JPL Horizons; other
stars get their confirmed exoplanets. Orbits are drawn as ellipses and bodies are propagated
along them by a Kepler solver against the current epoch. Under them, a dashed grid marks out
round distances in AU — 5 AU rings for the solar system, 0.01 AU rings for TRAPPIST-1 — with a
drop line from each body, so eccentricity and inclination read against a circular reference
instead of having to be inferred from a shape in space. The camera frames that grid rather than
the orbits, from the field of view it actually has, so the outermost ring sits inside the frame
with room around it at any system scale and any window shape.

The star at the centre is sized against the system's *innermost* orbit, so it can never swallow
its closest planet, while the camera is placed to frame the *outermost* ring — and in the solar
system those differ by a factor of a hundred. At the distance that fits Pluto in view, a disc
that stays clear of Mercury is about a pixel across, and no radius satisfies both. So the disc
stays honest to the orbits and the star's halo carries its visibility, floored against the framed
radius: light is not a surface, and a glow reaching past the innermost orbit says the star is
bright rather than that it is large.

**Body detail** — a dedicated close-up scene and info panel for one planet, moon or exoplanet,
with real photography where NASA/ESA/USGS imagery exists, and a surface derived from the body's
own measurements where it does not. See "On surfaces that were never photographed" below.

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
  relative to whichever plane that system's elements were measured in, rather than by rotating
  the world into a convenient pose. That plane is per-system, not global: one fixed viewing
  direction is face-on for the solar system and edge-on for an exoplanet system whose host star
  lies elsewhere on the sky. It is also the plane the system's reference grid lies in.
- **Two coordinate scales.** The galaxy view works in parsecs and the system view in AU —
  about eight orders of magnitude apart, which wrecks float precision if rendered in one unit
  space. The camera rig recentres the active star to the origin ("floating origin") and swaps
  the unit scale and near/far planes at the transition point.
- **The galactic scale is not a third space.** It is the same parsec space as the galaxy view,
  four orders of magnitude further out, so no swap is needed — the Milky Way model and the
  catalogued star field crossfade against camera distance and the depth range scales with it.
  One fixed near/far pair cannot serve both ends: flying into a star needs a near plane a
  hundredth of a parsec out, and holding the Galaxy needs a far plane a hundred thousand
  parsecs out, and a projection spanning both has no precision left to separate one arm from
  the next.
- **No backend.** Every dataset is baked at build time into `src/assets/data/` and served as a
  static asset. Nothing queries an astronomy API at runtime.

### On surfaces that were never photographed

Fifteen bodies here have a real photograph. Everything else does not, and never will on current
instruments: no exoplanet's surface has ever been imaged, and a few of the solar system's own
moons have no usable map in this asset set either.

Those bodies get a surface reasoned from what *has* been measured, in a chain that is worth
following because every link is standard:

1. The host star's **luminosity** comes from its catalogued apparent magnitude and its
   parallax distance — that pair is exactly an absolute magnitude — plus a bolometric correction
   for its spectral class. The correction is not optional: an M dwarf radiates most of its light
   in the infrared, so its visual magnitude understates it by more than tenfold, and M dwarfs are
   what most nearby planet hosts are. Good to about a factor of two, which matters less than it
   sounds: temperature goes as the fourth root.
2. Luminosity and the planet's semi-major axis give its **equilibrium temperature**, the standard
   blackbody balance. Checked against the solar system it lands on Earth 255 K, Jupiter 112 K,
   Neptune 46 K — all within a kelvin or two of published values — and puts 51 Pegasi b at
   1227 K against a published 1200.
3. Published mass and radius give **bulk density**, which is the difference between a ball of
   iron, of rock, of water and of hydrogen.
4. Size fixes the family, temperature the state within it, and density overrides both at the
   extremes. That yields a class — molten, scorched, iron-rich, rocky, temperate, ice, sub-
   Neptune, ice giant, gas giant, hot gas giant — each with a palette reasoned from its chemistry.
   Methane absorbs red light, which is why the ice giants are blue; ammonia cloud tops are cream
   and ochre; silicate cloud decks over a glowing interior are why hot Jupiters are drawn deep red.
5. The surface is then painted from that class: **zonal bands** for a body with a fluid envelope,
   because a rapidly rotating atmosphere organises into them, and fractal **terrain** for one
   with a solid surface. Polar caps grow and shrink with the derived temperature.

The generator samples three-dimensional noise along the sphere rather than a flat field, so
there is no seam to stitch at the antimeridian and no pinching at the poles, and it writes into
a plain byte array rather than a canvas — which makes it a pure function with no DOM to depend on.
Each body's surface is seeded from its own id, so it looks the same on every visit.

The limits are worth stating. Equilibrium temperature ignores greenhouse warming and internal
heat, which is why Venus comes out at 300 K against a real surface of 737 K, and why Io — kept
molten by tidal heating — classifies as ice. Luminosity classes are often missing from the star
catalogue, so a red giant read as a dwarf will come out too bright. And the surfaces are
illustrations throughout: the info panel says so on every body that has one, next to the
measurements it was reasoned from.

### On the Galaxy model

Every other dataset here is measured. The Galaxy is the exception, and not for want of trying:
we sit inside its disc, and dust blocks the view across it, so no catalogue holds the positions
of its stars. Every rendering of the Milky Way seen face-on — including NASA's — is a model.

What *is* measured is the skeleton, and that is what `shared/astro/galaxy.ts` contains: the
directions of the galactic centre and the north galactic pole, which fix the disc's 63° tilt
against the celestial equator; the 8.18 kpc from the Sun to the centre, from the orbit of the
star S2 around Sgr A*; and a reference radius, azimuth and pitch angle per spiral arm,
approximating the maser-parallax fits. The Sun's placement on the Orion Spur and the arms either
side of it follow from those numbers rather than being posed by hand.

The particles scattered around that skeleton are illustrative — a seeded, reproducible cloud, not
observations. The galactic view says so on screen, and the model fades out entirely before the
camera reaches the catalogued 50 pc the real stars occupy.

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
  features/galaxy-system/  shared galactic+galaxy+system scene, camera rig, star field,
                           Milky Way model, grid planes, deep-sky backdrop, orbits,
                           labels, HUD
  features/body-detail/    close-up scene and info panel
  features/search/         name search across every dataset
  shared/astro/         coordinates, Kepler propagator, deep-sky classification,
                        Milky Way structure
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
