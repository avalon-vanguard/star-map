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
  /** Mean radius: for a triaxial body, the radius of the sphere of its volume, which is how it is drawn. */
  radiusKm: number;
  /**
   * A triaxial body's three semi-axes, in km, largest first, where its shape is too far from a
   * sphere for one radius to say it: Haumea's 1161 x 852 x 513 (Ortiz et al. 2017), whose mean
   * radius is 798.
   */
  semiAxesKm?: readonly [number, number, number];
  /** Mean elements at `orbit.epochJd`, moving at `rates`. */
  orbit: OrbitalElements;
  rates: MeanElementRates;
  /**
   * The pole of the plane a moon's elements are measured against, where that is its local
   * Laplace plane or, for Uranus's and Pluto's moons, the planet's equator: right ascension and
   * declination in the ICRF. The node is then counted from where that plane crosses the ICRF
   * equator. Absent means the J2000 ecliptic, as for the planets and the Moon.
   */
  laplacePole?: { raDeg: number; decDeg: number };
  /** Where the elements come from and the span they hold over, as the card prints it. */
  orbitSource: string;
  /**
   * The eccentricity the card prints, where it is not the orbit's own: Hyperion's row in the table
   * its orbit is drawn from gives 0.0232, under a quarter of the 0.105 JPL's current table (SAT441)
   * and Horizons (0.074 to 0.132 from 1980 to 2100) give. The older row still places Hyperion
   * nearer where Horizons has it than the same row with 0.105 does, so the orbit keeps it.
   */
  measuredEccentricity?: number;
  /**
   * For `kind: 'moon'`, the `id` of the planet it orbits — its `orbit` is expressed
   * relative to that planet, not heliocentrically. Undefined for planets/dwarfs.
   */
  parentBodyId?: string;
  /**
   * For a moon heavy enough that it and its planet go round a point outside the planet — Charon,
   * an eighth of Pluto's mass, puts it 2 100 km from Pluto's centre, 900 km above its surface —
   * the moon's mass over the planet's, from the GMs on their Horizons pages. The planet's own
   * elements then place that barycentre, as Standish's "Pluto" does, and both bodies are drawn
   * going round it. Absent for every other moon.
   */
  massRatio?: number;
  /**
   * How the body turns on its own axis: the sidereal rotation period in hours, negative where
   * Horizons gives a negative rate (Venus, Uranus), and the tilt of that axis from its orbital
   * plane — which past 90 degrees already says the turn is retrograde.
   *
   * For a locked moon the period is its orbit's, from the mean motion that carries it round; for
   * a body whose source states none, the measured one its ETL spec carries (Eris, Nereid). Absent
   * only for Hyperion, which tumbles — the view leaves it still rather than spinning it at an
   * invented rate.
   */
  rotationPeriodHours?: number;
  obliquityDeg?: number;
  /**
   * Where the body's pole points and which way its prime meridian faces at any date, from the IAU
   * WGCCRE 2015 report (Archinal et al. 2018) as NAIF's `pck00011.tpc` carries it, but that a locked
   * moon's W turns at its drawn orbit's rate and Iapetus's pole goes round with its orbit's, so they
   * keep their faces to their planets over the clock's AD 1 to 3000 (see `lockedToOrbit` in the
   * ETL). Where present it alone sets how the body is drawn, and the ETL checks the period and
   * obliquity above against it. Absent where the report gives none: Hyperion tumbles, and Nereid,
   * Eris, Haumea and Makemake have no model.
   */
  rotationalElements?: RotationalElements;
}

/**
 * The IAU's rotational elements for one body: polynomials in time, plus periodic terms.
 *
 * The pole's right ascension and declination are in degrees in the ICRF, `[c0, c1, c2]` for
 * `c0 + c1 T + c2 T²`, T in Julian centuries from J2000.0 TDB. The prime meridian W is the angle
 * along the body's equator, anticlockwise seen from above that pole, from where the equator rises
 * through the ICRF equator to the body's longitude 0, `c0 + c1 d + c2 d²` with d in days. A
 * negative rate turns the body clockwise about the pole the IAU names: Venus, Uranus and its
 * moons, Triton.
 */
export interface RotationalElements {
  poleRaDeg: number[];
  poleDecDeg: number[];
  primeMeridianDeg: number[];
  /**
   * Each adds `ra sin θ` to the right ascension, `dec cos θ` to the declination and `pm sin θ` to
   * W, θ being `angleDeg[0] + angleDeg[1] T + angleDeg[2] T²`. The smallest are left out; see
   * `parsePckRotationalElements`.
   */
  terms?: Array<{ angleDeg: number[]; ra: number; dec: number; pm: number }>;
}
