/** Astronomical unit conversion and gravitational constants shared by the astro math modules. */

/** Number of astronomical units in one parsec (IAU exact definition). */
export const AU_PER_PARSEC = 206264.80624709636;

/**
 * Reference epoch (Julian date, J2000.0) used when orbital data lacks an explicit epoch —
 * e.g. exoplanets from the NASA Exoplanet Archive only report a handful of elements
 * (semi-major axis, eccentricity, sometimes argument of periapsis), not a mean-anomaly/epoch
 * pair. Defaulting the missing epoch to J2000 still lets the body's real orbital period
 * carry it around a plausible (if not phase-accurate) orbit over time.
 */
export const DEFAULT_EPOCH_JD = 2451545.0;

/**
 * Heliocentric gravitational parameter (GM of the Sun), in AU^3/day^2 — the square of the
 * Gaussian gravitational constant `k = 0.01720209895 rad/day`. Used to derive a body's mean
 * motion from its semi-major axis via Kepler's third law.
 */
export const GM_SUN_AU3_PER_DAY2 = 0.01720209895 * 0.01720209895;

/**
 * Approximate planet/Sun mass ratios for the major planets that host moons in `bodies.json`.
 * Used to derive each planet's gravitational parameter (for propagating its moons) as
 * `GM_SUN_AU3_PER_DAY2 * massRatio`. Precise enough for visualization; not JPL-grade.
 */
const PLANET_TO_SUN_MASS_RATIO: Record<string, number> = {
  earth: 3.003e-6,
  mars: 3.227e-7,
  jupiter: 9.545e-4,
  saturn: 2.857e-4,
  uranus: 4.365e-5,
  neptune: 5.151e-5
};

/**
 * Gravitational parameter (AU^3/day^2) to use when propagating a body's orbit: the Sun's
 * for planets/dwarfs/exoplanets, or the host planet's (derived from its Sun mass ratio) for
 * moons. Falls back to the Sun's GM if `parentBodyId` isn't a known planet.
 */
export function gmForParent(parentBodyId: string | undefined): number {
  if (!parentBodyId) {
    return GM_SUN_AU3_PER_DAY2;
  }
  const massRatio = PLANET_TO_SUN_MASS_RATIO[parentBodyId];
  return massRatio ? GM_SUN_AU3_PER_DAY2 * massRatio : GM_SUN_AU3_PER_DAY2;
}

/** Converts a JS `Date` into a Julian date (days), for driving the Kepler propagator "now". */
export function dateToJulianDate(date: Date = new Date()): number {
  return date.getTime() / 86400000 + 2440587.5;
}
