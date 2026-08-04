import { CartesianCoordinates } from './coordinates';
import { DEFAULT_EPOCH_JD, GM_SUN_AU3_PER_DAY2 } from './constants';
import { OrbitalElements } from '../models/body.model';

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/**
 * Fills in the elements the Kepler propagator needs but that some sources (e.g. exoplanets,
 * see `ExoplanetRecord.orbit: Partial<OrbitalElements>`) don't report: eccentricity,
 * inclination, longitude of ascending node, mean anomaly at epoch, and the epoch itself.
 * Missing angles default to zero (a face-on, unrotated ellipse) and the missing epoch defaults
 * to J2000 — enough to draw a plausible, period-correct orbit even without full data.
 *
 * A missing eccentricity defaults to 0, a circle. That is the conventional assumption for an
 * orbit whose shape has not been constrained, and it is also the only honest one available: the
 * semi-major axis alone says nothing about elongation. It matters because the archive publishes
 * an axis far more often than an eccentricity — 1509 exoplanets have the first without the
 * second — and treating those as undrawable simply hid them.
 */
export function resolveOrbitalElements(partial: Partial<OrbitalElements> & Pick<OrbitalElements, 'semiMajorAxisAu'>): OrbitalElements {
  return {
    semiMajorAxisAu: partial.semiMajorAxisAu,
    eccentricity: partial.eccentricity ?? 0,
    inclinationDeg: partial.inclinationDeg ?? 0,
    longitudeOfAscendingNodeDeg: partial.longitudeOfAscendingNodeDeg ?? 0,
    argumentOfPeriapsisDeg: partial.argumentOfPeriapsisDeg ?? 0,
    meanAnomalyAtEpochDeg: partial.meanAnomalyAtEpochDeg ?? 0,
    epochJd: partial.epochJd ?? DEFAULT_EPOCH_JD
  };
}

/**
 * Whether a partially-specified orbit can actually be propagated as an ellipse.
 *
 * Everything downstream — the mean motion, the Kepler solver, the ellipse sampling — assumes a
 * closed elliptical orbit around a positive semi-major axis. Feed it anything else and it does
 * not throw: `sqrt` of a negative number and division by zero both yield `NaN`, which
 * propagates silently into the vertex buffer and poisons the geometry's bounding sphere, taking
 * out culling for the whole object rather than just the bad orbit.
 *
 * A missing eccentricity is fine and defaults to a circle (see {@link resolveOrbitalElements});
 * a present but non-elliptical one (`e >= 1`, an escape trajectory) is not, since no ellipse
 * describes it.
 */
export function isPropagatableOrbit(
  partial: Partial<OrbitalElements>
): partial is Partial<OrbitalElements> & Pick<OrbitalElements, 'semiMajorAxisAu'> {
  const { semiMajorAxisAu, eccentricity } = partial;

  if (semiMajorAxisAu === undefined || !Number.isFinite(semiMajorAxisAu) || semiMajorAxisAu <= 0) {
    return false;
  }
  if (eccentricity !== undefined && (!Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1)) {
    return false;
  }
  return true;
}

/** Mean motion (rad/day) of a body via Kepler's third law: n = sqrt(GM / a^3). */
export function meanMotionRadPerDay(semiMajorAxisAu: number, gmAu3PerDay2: number): number {
  return Math.sqrt(gmAu3PerDay2 / (semiMajorAxisAu * semiMajorAxisAu * semiMajorAxisAu));
}

/** Orbital period (days) of a body via Kepler's third law: T = 2*pi / n. */
export function orbitalPeriodDays(semiMajorAxisAu: number, gmAu3PerDay2: number): number {
  return TWO_PI / meanMotionRadPerDay(semiMajorAxisAu, gmAu3PerDay2);
}

/**
 * Gravitational parameter implied by a measured orbital period — the inverse of
 * {@link orbitalPeriodDays}: `GM = n^2 * a^3`, with `n = 2*pi / T`.
 *
 * This is how an exoplanet's host star gets its mass into the propagator. Nothing about the
 * star needs to be known or guessed: the period and the semi-major axis between them pin the
 * gravitational parameter exactly.
 */
export function gravitationalParameterFromPeriod(semiMajorAxisAu: number, periodDays: number): number {
  const meanMotion = TWO_PI / periodDays;
  return meanMotion * meanMotion * semiMajorAxisAu * semiMajorAxisAu * semiMajorAxisAu;
}

/**
 * Plausible range for a host star's mass, in solar masses — from below the hydrogen-burning
 * limit to beyond the heaviest known stars. Used only to reject a derived value that cannot be
 * a star, which would otherwise send a planet spinning at a visibly absurd rate.
 */
const MIN_PLAUSIBLE_STELLAR_MASS_SOLAR = 0.01;
const MAX_PLAUSIBLE_STELLAR_MASS_SOLAR = 150;

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

/**
 * The gravitational parameter to propagate a planet with, in AU^3/day^2, best source first:
 *
 * 1. **Its measured orbital period.** Exact, and independent of any stellar model.
 * 2. **Its host star's measured mass.**
 * 3. **One solar mass**, as a last resort.
 *
 * Falling back to the Sun is a real approximation, not a neutral default. Most exoplanet hosts
 * are red dwarfs far lighter than the Sun, and a heavier central mass pulls harder and shortens
 * the period, so assuming solar mass makes their planets whirl round far too fast. TRAPPIST-1
 * is 0.09 solar masses; its planets were completing an orbit in roughly a third of the true
 * time.
 */
export function resolveGravitationalParameter(input: {
  semiMajorAxisAu: number;
  periodDays?: number;
  hostStarMassSolar?: number;
}): number {
  const { semiMajorAxisAu, periodDays, hostStarMassSolar } = input;

  if (isPositiveFinite(periodDays) && isPositiveFinite(semiMajorAxisAu)) {
    const derived = gravitationalParameterFromPeriod(semiMajorAxisAu, periodDays);
    const impliedMassSolar = derived / GM_SUN_AU3_PER_DAY2;
    // A period and axis drawn from disagreeing solutions can imply something that is not a
    // star; prefer a known-approximate answer over a confidently wrong one.
    if (impliedMassSolar >= MIN_PLAUSIBLE_STELLAR_MASS_SOLAR && impliedMassSolar <= MAX_PLAUSIBLE_STELLAR_MASS_SOLAR) {
      return derived;
    }
  }

  if (
    isPositiveFinite(hostStarMassSolar) &&
    hostStarMassSolar >= MIN_PLAUSIBLE_STELLAR_MASS_SOLAR &&
    hostStarMassSolar <= MAX_PLAUSIBLE_STELLAR_MASS_SOLAR
  ) {
    return GM_SUN_AU3_PER_DAY2 * hostStarMassSolar;
  }

  return GM_SUN_AU3_PER_DAY2;
}

/** Normalizes an angle (radians) into [0, 2*pi). */
function normalizeAngle(angleRad: number): number {
  const wrapped = angleRad % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/**
 * Solves Kepler's equation `M = E - e*sin(E)` for the eccentric anomaly `E` (radians) via
 * Newton-Raphson iteration.
 */
export function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number, tolerance = 1e-8, maxIterations = 30): number {
  const m = normalizeAngle(meanAnomalyRad);
  let e = eccentricity < 0.8 ? m : Math.PI;

  for (let i = 0; i < maxIterations; i++) {
    const delta = (e - eccentricity * Math.sin(e) - m) / (1 - eccentricity * Math.cos(e));
    e -= delta;
    if (Math.abs(delta) < tolerance) {
      break;
    }
  }

  return e;
}

/** Converts an eccentric anomaly (radians) into the true anomaly (radians). */
export function trueAnomalyFromEccentricAnomaly(eccentricAnomalyRad: number, eccentricity: number): number {
  const cosE = Math.cos(eccentricAnomalyRad);
  const sinE = Math.sin(eccentricAnomalyRad);
  return Math.atan2(Math.sqrt(1 - eccentricity * eccentricity) * sinE, cosE - eccentricity);
}

/**
 * Places a point at the given true anomaly (radians) along the orbit described by
 * `elements`, in AU, relative to the central body (the Sun for planets/dwarfs, the host
 * planet for moons — see `BodyRecord.parentBodyId`). Standard perifocal-to-reference-frame
 * rotation: argument of periapsis, then inclination, then longitude of ascending node.
 */
export function positionAtTrueAnomaly(elements: OrbitalElements, trueAnomalyRad: number): CartesianCoordinates {
  const { semiMajorAxisAu: a, eccentricity: e } = elements;
  const semiLatusRectum = a * (1 - e * e);
  const radius = semiLatusRectum / (1 + e * Math.cos(trueAnomalyRad));

  // Position in the perifocal (orbital-plane) frame: +x toward periapsis.
  const xPerifocal = radius * Math.cos(trueAnomalyRad);
  const yPerifocal = radius * Math.sin(trueAnomalyRad);

  const omega = elements.argumentOfPeriapsisDeg * DEG_TO_RAD; // argument of periapsis
  const inclination = elements.inclinationDeg * DEG_TO_RAD;
  const raan = elements.longitudeOfAscendingNodeDeg * DEG_TO_RAD; // right ascension of ascending node

  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);

  // Rotate by argument of periapsis within the orbital plane first.
  const xOrbitPlane = xPerifocal * cosOmega - yPerifocal * sinOmega;
  const yOrbitPlane = xPerifocal * sinOmega + yPerifocal * cosOmega;

  // Tilt by inclination, then rotate by the longitude of the ascending node.
  const xTilted = xOrbitPlane;
  const yTilted = yOrbitPlane * cosInclination;
  const zTilted = yOrbitPlane * sinInclination;

  return {
    x: xTilted * cosRaan - yTilted * sinRaan,
    y: xTilted * sinRaan + yTilted * cosRaan,
    z: zTilted
  };
}

/**
 * Propagates `elements` to Julian date `epochJdEval`, returning the body's position (AU)
 * relative to its central body. This is the app's "current epoch" evaluation used for live
 * (and future time-scrubbable) positions, as opposed to {@link orbitEllipsePoints} which
 * samples the fixed orbit shape independent of time.
 */
export function propagateOrbit(elements: OrbitalElements, gmAu3PerDay2: number, epochJdEval: number): CartesianCoordinates {
  const meanMotion = meanMotionRadPerDay(elements.semiMajorAxisAu, gmAu3PerDay2);
  const meanAnomalyRad = elements.meanAnomalyAtEpochDeg * DEG_TO_RAD + meanMotion * (epochJdEval - elements.epochJd);
  const eccentricAnomalyRad = solveEccentricAnomaly(meanAnomalyRad, elements.eccentricity);
  const trueAnomalyRad = trueAnomalyFromEccentricAnomaly(eccentricAnomalyRad, elements.eccentricity);
  return positionAtTrueAnomaly(elements, trueAnomalyRad);
}

/**
 * Samples `segments` points around the fixed shape of the orbit (AU, relative to the central
 * body), for drawing the orbit ellipse. Independent of epoch/time — unlike {@link propagateOrbit}.
 */
export function orbitEllipsePoints(elements: OrbitalElements, segments = 128): CartesianCoordinates[] {
  const points: CartesianCoordinates[] = [];
  for (let i = 0; i <= segments; i++) {
    const trueAnomalyRad = (i / segments) * TWO_PI;
    points.push(positionAtTrueAnomaly(elements, trueAnomalyRad));
  }
  return points;
}
