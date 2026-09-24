/**
 * Keplerian orbital elements at a reference epoch. Positions are derived client-side by
 * propagating these elements forward/backward from `epochJd` (see `shared/astro/kepler.ts`),
 * rather than fetching per-frame positions.
 */
export interface OrbitalElements {
  semiMajorAxisAu: number;
  eccentricity: number;
  inclinationDeg: number;
  longitudeOfAscendingNodeDeg: number;
  argumentOfPeriapsisDeg: number;
  meanAnomalyAtEpochDeg: number;
  epochJd: number;
}

/**
 * How a body's mean elements move away from their epoch, per day.
 *
 * Mean elements rather than one osculating set, because the map's clock runs decades in minutes.
 * An osculating orbit is exact at its instant and drifts from then on: fed to Kepler with a mass
 * ratio, the Moon's went round in 27.70 days instead of 27.32 and was 66 degrees out after a year.
 * A mean set carries its own measured motion, and the slow turning of its node and periapsis, so
 * it holds for as long as its source was fit over.
 */
export interface MeanElementRates {
  /**
   * How fast the body goes round in space, in degrees per day: the rate of its mean longitude.
   * 360 over this is its sidereal period.
   */
  meanMotionDegPerDay: number;
  longitudeOfAscendingNodeDegPerDay: number;
  argumentOfPeriapsisDegPerDay: number;
  semiMajorAxisAuPerDay?: number;
  eccentricityPerDay?: number;
  inclinationDegPerDay?: number;
  /**
   * Standish's extra terms in the mean anomaly of Jupiter and beyond, `b T² + c cos(f T) +
   * s sin(f T)` degrees, with T in Julian centuries from the epoch and f in degrees per century:
   * the great-inequality wobble his 3000 BC to AD 3000 fit needs on top of its linear rates.
   */
  meanAnomalyTerms?: { b: number; c: number; s: number; f: number };
}

/**
 * A solar-system planet, moon, or dwarf planet: JPL mean orbital elements, and JPL Horizons
 * physical data. `systemStarId` links back to the HYG star index (the Sun, see `SUN_STAR_ID`).
 */
export interface BodyRecord {
  id: string;
  systemStarId: number;
  name: string;
  kind: 'planet' | 'moon' | 'dwarf';
  radiusKm: number;
  /** Mean elements at `orbit.epochJd`, moving at `rates`. */
  orbit: OrbitalElements;
  rates: MeanElementRates;
  /**
   * The pole of the plane a moon's elements are measured against, where that is its local
   * Laplace plane: right ascension and declination in the ICRF. The node is then counted from
   * where that plane crosses the ICRF equator. Absent means the J2000 ecliptic, as for the
   * planets and the Moon.
   */
  laplacePole?: { raDeg: number; decDeg: number };
  /** Where the elements come from and the span they hold over, as the card prints it. */
  orbitSource: string;
  /**
   * For `kind: 'moon'`, the `id` of the planet it orbits — its `orbit` is expressed
   * relative to that planet, not heliocentrically. Undefined for planets/dwarfs.
   */
  parentBodyId?: string;
  /**
   * How the body turns on its own axis: the sidereal rotation period in hours, negative where
   * Horizons gives a negative rate (Venus, Uranus), and the tilt of that axis from its orbital
   * plane — which past 90 degrees already says the turn is retrograde.
   *
   * Absent where Horizons publishes neither — the view then leaves the body still rather than
   * spinning it at an invented rate.
   */
  rotationPeriodHours?: number;
  obliquityDeg?: number;
}
