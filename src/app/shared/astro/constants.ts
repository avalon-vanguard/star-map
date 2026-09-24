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

/** Converts a JS `Date` into a Julian date (days), for driving the Kepler propagator "now". */
export function dateToJulianDate(date: Date = new Date()): number {
  return date.getTime() / 86400000 + 2440587.5;
}
