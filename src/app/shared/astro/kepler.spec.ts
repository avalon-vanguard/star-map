import { describe, expect, it } from 'vitest';

import { GM_SUN_AU3_PER_DAY2, DEFAULT_EPOCH_JD } from './constants';
import {
  meanMotionRadPerDay,
  orbitEllipsePoints,
  orbitalPeriodDays,
  positionAtTrueAnomaly,
  propagateOrbit,
  resolveOrbitalElements,
  solveEccentricAnomaly,
  trueAnomalyFromEccentricAnomaly
} from './kepler';

// Earth's actual orbital elements (osculating, ~J2000), used as a real-world reference case.
const EARTH_ELEMENTS = {
  semiMajorAxisAu: 1.00000011,
  eccentricity: 0.01671022,
  inclinationDeg: 0.00005,
  longitudeOfAscendingNodeDeg: -11.26064,
  argumentOfPeriapsisDeg: 102.94719,
  meanAnomalyAtEpochDeg: 100.46435,
  epochJd: DEFAULT_EPOCH_JD
};

describe('solveEccentricAnomaly', () => {
  it('satisfies Keplers equation for a range of eccentricities', () => {
    for (const eccentricity of [0, 0.0167, 0.3, 0.6, 0.9]) {
      for (const meanAnomalyRad of [0, 0.5, 1.5, 3.0, 5.5]) {
        const e = solveEccentricAnomaly(meanAnomalyRad, eccentricity);
        const residual = e - eccentricity * Math.sin(e) - meanAnomalyRad;
        // residual is computed against the (possibly un-normalized) input, but the solver
        // normalizes internally, so compare against the normalized mean anomaly instead.
        const normalizedMeanAnomaly = ((meanAnomalyRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        expect(e - eccentricity * Math.sin(e)).toBeCloseTo(normalizedMeanAnomaly, 6);
        expect(Number.isFinite(residual)).toBe(true);
      }
    }
  });
});

describe('trueAnomalyFromEccentricAnomaly', () => {
  it('returns 0 at periapsis and pi at apoapsis', () => {
    expect(trueAnomalyFromEccentricAnomaly(0, 0.3)).toBeCloseTo(0, 9);
    expect(trueAnomalyFromEccentricAnomaly(Math.PI, 0.3)).toBeCloseTo(Math.PI, 9);
  });

  it('matches the eccentric anomaly exactly for a circular orbit', () => {
    expect(trueAnomalyFromEccentricAnomaly(1.234, 0)).toBeCloseTo(1.234, 9);
  });
});

describe('positionAtTrueAnomaly', () => {
  it('places a circular, unrotated orbit at radius = semiMajorAxisAu for every true anomaly', () => {
    const circular = resolveOrbitalElements({ semiMajorAxisAu: 2.5, eccentricity: 0 });

    for (const trueAnomalyRad of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const { x, y, z } = positionAtTrueAnomaly(circular, trueAnomalyRad);
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(2.5, 9);
    }
  });

  it('reaches periapsis distance a*(1-e) and apoapsis distance a*(1+e)', () => {
    const elements = resolveOrbitalElements({ semiMajorAxisAu: 10, eccentricity: 0.2 });

    const periapsis = positionAtTrueAnomaly(elements, 0);
    const apoapsis = positionAtTrueAnomaly(elements, Math.PI);

    expect(Math.hypot(periapsis.x, periapsis.y, periapsis.z)).toBeCloseTo(8, 9);
    expect(Math.hypot(apoapsis.x, apoapsis.y, apoapsis.z)).toBeCloseTo(12, 9);
  });

  it('tilts a 90-degree-inclined orbit entirely onto the z axis at true anomaly 90 degrees', () => {
    const elements = resolveOrbitalElements({ semiMajorAxisAu: 1, eccentricity: 0, inclinationDeg: 90 });

    const { x, y, z } = positionAtTrueAnomaly(elements, Math.PI / 2);

    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(1, 9);
  });
});

describe('meanMotionRadPerDay / orbitalPeriodDays', () => {
  it('reproduces Earths ~365.25-day year from its semi-major axis', () => {
    const period = orbitalPeriodDays(EARTH_ELEMENTS.semiMajorAxisAu, GM_SUN_AU3_PER_DAY2);
    expect(period).toBeCloseTo(365.25, 0);
  });

  it('is the inverse of orbitalPeriodDays', () => {
    const n = meanMotionRadPerDay(1, GM_SUN_AU3_PER_DAY2);
    const period = orbitalPeriodDays(1, GM_SUN_AU3_PER_DAY2);
    expect(n * period).toBeCloseTo(2 * Math.PI, 9);
  });
});

describe('propagateOrbit', () => {
  it('reduces to the instantaneous position at the elements own epoch', () => {
    const eccentricAnomalyRad = solveEccentricAnomaly((EARTH_ELEMENTS.meanAnomalyAtEpochDeg * Math.PI) / 180, EARTH_ELEMENTS.eccentricity);
    const trueAnomalyRad = trueAnomalyFromEccentricAnomaly(eccentricAnomalyRad, EARTH_ELEMENTS.eccentricity);
    const expected = positionAtTrueAnomaly(EARTH_ELEMENTS, trueAnomalyRad);

    const actual = propagateOrbit(EARTH_ELEMENTS, GM_SUN_AU3_PER_DAY2, EARTH_ELEMENTS.epochJd);

    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
    expect(actual.z).toBeCloseTo(expected.z, 9);
  });

  it('stays within the periapsis/apoapsis distance bounds after propagating forward a year', () => {
    const period = orbitalPeriodDays(EARTH_ELEMENTS.semiMajorAxisAu, GM_SUN_AU3_PER_DAY2);
    const { x, y, z } = propagateOrbit(EARTH_ELEMENTS, GM_SUN_AU3_PER_DAY2, EARTH_ELEMENTS.epochJd + period * 0.37);
    const distance = Math.hypot(x, y, z);

    const { semiMajorAxisAu: a, eccentricity: e } = EARTH_ELEMENTS;
    expect(distance).toBeGreaterThanOrEqual(a * (1 - e) - 1e-6);
    expect(distance).toBeLessThanOrEqual(a * (1 + e) + 1e-6);
  });

  it('returns to (very nearly) the same position after exactly one full orbital period', () => {
    const period = orbitalPeriodDays(EARTH_ELEMENTS.semiMajorAxisAu, GM_SUN_AU3_PER_DAY2);
    const start = propagateOrbit(EARTH_ELEMENTS, GM_SUN_AU3_PER_DAY2, EARTH_ELEMENTS.epochJd + 12.3);
    const afterOneOrbit = propagateOrbit(EARTH_ELEMENTS, GM_SUN_AU3_PER_DAY2, EARTH_ELEMENTS.epochJd + 12.3 + period);

    expect(afterOneOrbit.x).toBeCloseTo(start.x, 6);
    expect(afterOneOrbit.y).toBeCloseTo(start.y, 6);
    expect(afterOneOrbit.z).toBeCloseTo(start.z, 6);
  });
});

describe('orbitEllipsePoints', () => {
  it('samples a closed loop whose distances stay within the periapsis/apoapsis bounds', () => {
    const elements = resolveOrbitalElements({ semiMajorAxisAu: 5, eccentricity: 0.4 });
    const points = orbitEllipsePoints(elements, 64);

    expect(points).toHaveLength(65);
    for (const { x, y, z } of points) {
      const distance = Math.hypot(x, y, z);
      expect(distance).toBeGreaterThanOrEqual(5 * (1 - 0.4) - 1e-9);
      expect(distance).toBeLessThanOrEqual(5 * (1 + 0.4) + 1e-9);
    }

    // The first and last sampled points (true anomaly 0 and 2*pi) should coincide.
    expect(points[0].x).toBeCloseTo(points[64].x, 9);
    expect(points[0].y).toBeCloseTo(points[64].y, 9);
    expect(points[0].z).toBeCloseTo(points[64].z, 9);
  });
});

describe('resolveOrbitalElements', () => {
  it('defaults missing angles to 0 and the missing epoch to J2000', () => {
    const resolved = resolveOrbitalElements({ semiMajorAxisAu: 1.5, eccentricity: 0.1 });

    expect(resolved.inclinationDeg).toBe(0);
    expect(resolved.longitudeOfAscendingNodeDeg).toBe(0);
    expect(resolved.argumentOfPeriapsisDeg).toBe(0);
    expect(resolved.meanAnomalyAtEpochDeg).toBe(0);
    expect(resolved.epochJd).toBe(DEFAULT_EPOCH_JD);
  });

  it('preserves explicitly provided fields', () => {
    const resolved = resolveOrbitalElements({ semiMajorAxisAu: 1.5, eccentricity: 0.1, argumentOfPeriapsisDeg: 50 });
    expect(resolved.argumentOfPeriapsisDeg).toBe(50);
  });
});
