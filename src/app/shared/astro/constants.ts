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
 * TT - UTC today, in days: 32.184 s plus the 37 leap seconds UTC has taken since 1972, the last at
 * the end of 2016. TDB, which ephemerides run on, stays within 2 ms of TT. See {@link ttMinusUtSeconds}
 * for other dates.
 */
export const TT_MINUS_UTC_DAYS = 69.184 / 86400;

/** The first day of each month UTC took a leap second at the start of, from its 10 s of 1972. */
const LEAP_SECONDS_FROM = [
  [1972, 7], [1973, 1], [1974, 1], [1975, 1], [1976, 1], [1977, 1], [1978, 1], [1979, 1], [1980, 1], [1981, 7],
  [1982, 7], [1983, 7], [1985, 7], [1988, 1], [1990, 1], [1991, 1], [1992, 7], [1993, 7], [1994, 7], [1996, 1],
  [1997, 7], [1999, 1], [2006, 1], [2009, 1], [2012, 7], [2015, 7], [2017, 1]
].map(([year, month]) => Date.UTC(year, month - 1, 1) / 86400000 + 2440587.5);
const JD_1972 = Date.UTC(1972, 0, 1) / 86400000 + 2440587.5;

/**
 * TT - UT, in seconds, at a date on the map's clock: how far Earth's turning, which UT counts,
 * has fallen behind the uniform time the ephemerides run on.
 *
 * From 1972 the clock is UTC, held to within 0.9 s of UT by leap seconds, and TT - UTC is exact:
 * 32.184 s plus the 10 to 37 of them. After the last, at the start of 2017, it is held at 69.184 s,
 * as Horizons holds it: no one knows the leap seconds to come. Before 1972 it is ΔT from the
 * Espenak-Meeus polynomials (NASA's Five Millennium Canon, 2006), which fit the historical record
 * of eclipses and occultations: 10 570 s at AD 1, 1 574 at AD 1000, 29 in 1950. Held at 69 s there,
 * as it was, every spin but Earth's was a turn of (ΔT - 69 s) times its rate out, 15 degrees for
 * Jupiter at AD 1000 and 106 at AD 1, and the Moon 0.22 and 1.43 degrees along its orbit.
 */
export function ttMinusUtSeconds(jdUt: number): number {
  if (jdUt >= JD_1972) {
    return 32.184 + 10 + LEAP_SECONDS_FROM.filter((from) => jdUt >= from).length;
  }
  const y = 2000 + (jdUt - 2451544.5) / 365.2425;
  if (y < 500) {
    const u = y / 100;
    return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3 - 0.1798452 * u ** 4 + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6;
  }
  if (y < 1600) {
    const u = (y - 1000) / 100;
    return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3 - 0.8503463 * u ** 4 - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6;
  }
  if (y < 1700) {
    const t = y - 1600;
    return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129;
  }
  if (y < 1800) {
    const t = y - 1700;
    return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000;
  }
  if (y < 1860) {
    const t = y - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7;
  }
  if (y < 1900) {
    const t = y - 1860;
    return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174;
  }
  if (y < 1920) {
    const t = y - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y < 1941) {
    const t = y - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547;
  }
  const t = y - 1975;
  return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
}

/**
 * The TDB date every element set here is evaluated at, for a date on the map's clock, which is
 * UT: Standish's T_eph, the SSD satellite and SBDB epochs and the IAU's d and T all run on TDB.
 * Positions and spins both go through this, so a locked moon's face and the orbit it is drawn on
 * are taken at the same instant; taken at the clock's date, the orbits ran 69 s behind the spins,
 * which is 0.9 degrees of Phobos's orbit and 0.16 of Io's.
 */
export function tdbFromUtc(jdUtc: number): number {
  return jdUtc + ttMinusUtSeconds(jdUtc) / 86400;
}

/** Converts a JS `Date` into a Julian date (days), for driving the Kepler propagator "now". */
export function dateToJulianDate(date: Date = new Date()): number {
  return date.getTime() / 86400000 + 2440587.5;
}
