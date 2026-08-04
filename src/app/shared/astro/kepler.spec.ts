import { describe, expect, it } from 'vitest';

import { GM_SUN_AU3_PER_DAY2, DEFAULT_EPOCH_JD } from './constants';
import {
  gravitationalParameterFromPeriod,
  isPropagatableOrbit,
  meanMotionRadPerDay,
  orbitEllipsePoints,
  orbitalPeriodDays,
  positionAtTrueAnomaly,
  propagateOrbit,
  resolveGravitationalParameter,
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

describe('gravitationalParameterFromPeriod', () => {
  it('round-trips with orbitalPeriodDays', () => {
    const derived = gravitationalParameterFromPeriod(1, 365.256);
    expect(orbitalPeriodDays(1, derived)).toBeCloseTo(365.256, 9);
  });

  it('recovers the Sun from Earth\'s orbit', () => {
    // 1 AU in one sidereal year is the definition of the solar gravitational parameter.
    const derived = gravitationalParameterFromPeriod(1, 365.256363);
    expect(derived / GM_SUN_AU3_PER_DAY2).toBeCloseTo(1, 4);
  });

  it('recovers a red dwarf from a real short-period orbit', () => {
    // TRAPPIST-1 b: 0.01154 AU in 1.51088 days around a 0.0898 solar-mass star.
    const derived = gravitationalParameterFromPeriod(0.01154, 1.51088);
    expect(derived / GM_SUN_AU3_PER_DAY2).toBeCloseTo(0.09, 2);
  });

  it('scales as a^3 at fixed period', () => {
    const single = gravitationalParameterFromPeriod(1, 100);
    const doubled = gravitationalParameterFromPeriod(2, 100);
    expect(doubled / single).toBeCloseTo(8, 9);
  });
});

describe('resolveGravitationalParameter', () => {
  it('prefers the measured period over everything else', () => {
    // The period says 0.09 solar masses; the (deliberately wrong) host mass says 5.
    const gm = resolveGravitationalParameter({ semiMajorAxisAu: 0.01154, periodDays: 1.51088, hostStarMassSolar: 5 });
    expect(gm / GM_SUN_AU3_PER_DAY2).toBeCloseTo(0.09, 2);
  });

  it('corrects a red dwarf planet that the solar-mass assumption spun too fast', () => {
    const withPeriod = resolveGravitationalParameter({ semiMajorAxisAu: 0.01154, periodDays: 1.51088 });
    const assumingSolar = resolveGravitationalParameter({ semiMajorAxisAu: 0.01154 });

    // A heavier central mass pulls harder, so it shortens the period: T scales as 1/sqrt(GM).
    // Assuming the Sun for TRAPPIST-1's 0.09 solar masses therefore made its planets orbit
    // sqrt(0.09) = 0.3x the true period — about 3.3x too fast, not too slow.
    expect(orbitalPeriodDays(0.01154, withPeriod)).toBeCloseTo(1.51088, 4);
    const ratio = orbitalPeriodDays(0.01154, assumingSolar) / orbitalPeriodDays(0.01154, withPeriod);
    expect(ratio).toBeCloseTo(Math.sqrt(0.09), 2);
  });

  it('falls back to the host star mass when no period is published', () => {
    const gm = resolveGravitationalParameter({ semiMajorAxisAu: 0.5, hostStarMassSolar: 0.31 });
    expect(gm).toBeCloseTo(GM_SUN_AU3_PER_DAY2 * 0.31, 12);
  });

  it('falls back to one solar mass when nothing is known', () => {
    expect(resolveGravitationalParameter({ semiMajorAxisAu: 1 })).toBe(GM_SUN_AU3_PER_DAY2);
  });

  it('ignores a period that is missing, zero, negative or not a number', () => {
    for (const periodDays of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveGravitationalParameter({ semiMajorAxisAu: 1, periodDays })).toBe(GM_SUN_AU3_PER_DAY2);
    }
  });

  it('ignores a host mass that is missing, zero or negative', () => {
    for (const hostStarMassSolar of [undefined, 0, -1, Number.NaN]) {
      expect(resolveGravitationalParameter({ semiMajorAxisAu: 1, hostStarMassSolar })).toBe(GM_SUN_AU3_PER_DAY2);
    }
  });

  it('rejects a period implying something that cannot be a star, and falls through', () => {
    // 1 AU in a single day implies thousands of solar masses.
    const gm = resolveGravitationalParameter({ semiMajorAxisAu: 1, periodDays: 1, hostStarMassSolar: 0.5 });
    expect(gm).toBeCloseTo(GM_SUN_AU3_PER_DAY2 * 0.5, 12);
  });

  it('rejects a period implying far too little mass', () => {
    // 1 AU taking a million days implies a mass far below any star.
    expect(resolveGravitationalParameter({ semiMajorAxisAu: 1, periodDays: 1e6 })).toBe(GM_SUN_AU3_PER_DAY2);
  });

  it('rejects an implausible host mass too', () => {
    expect(resolveGravitationalParameter({ semiMajorAxisAu: 1, hostStarMassSolar: 5000 })).toBe(GM_SUN_AU3_PER_DAY2);
  });

  it('keeps a real short-period hot Jupiter around a sun-like star', () => {
    // 51 Pegasi b: 0.0527 AU in 4.23 days around a ~1.1 solar-mass star.
    const gm = resolveGravitationalParameter({ semiMajorAxisAu: 0.0527, periodDays: 4.230785 });
    expect(gm / GM_SUN_AU3_PER_DAY2).toBeCloseTo(1.1, 1);
  });
});

describe('isPropagatableOrbit', () => {
  it('accepts an orbit with only a semi-major axis', () => {
    // 1509 archive records publish an axis and no eccentricity; they are perfectly drawable.
    expect(isPropagatableOrbit({ semiMajorAxisAu: 1 })).toBe(true);
  });

  it('accepts a fully specified elliptical orbit', () => {
    expect(isPropagatableOrbit({ semiMajorAxisAu: 0.05, eccentricity: 0.62 })).toBe(true);
  });

  it('accepts the boundary eccentricities of an ellipse', () => {
    expect(isPropagatableOrbit({ semiMajorAxisAu: 1, eccentricity: 0 })).toBe(true);
    expect(isPropagatableOrbit({ semiMajorAxisAu: 1, eccentricity: 0.999 })).toBe(true);
  });

  it('rejects an orbit with no semi-major axis at all', () => {
    expect(isPropagatableOrbit({})).toBe(false);
    expect(isPropagatableOrbit({ eccentricity: 0.1 })).toBe(false);
  });

  it('rejects a non-positive or non-finite semi-major axis', () => {
    // sqrt of a negative and division by zero both yield NaN rather than throwing.
    for (const semiMajorAxisAu of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isPropagatableOrbit({ semiMajorAxisAu })).toBe(false);
    }
  });

  it('rejects an eccentricity that is not an ellipse', () => {
    // e >= 1 is a parabolic or hyperbolic escape trajectory, which no ellipse describes.
    for (const eccentricity of [1, 1.4, -0.2, Number.NaN]) {
      expect(isPropagatableOrbit({ semiMajorAxisAu: 1, eccentricity })).toBe(false);
    }
  });
});

describe('resolveOrbitalElements eccentricity default', () => {
  it('treats a missing eccentricity as a circle', () => {
    expect(resolveOrbitalElements({ semiMajorAxisAu: 2 }).eccentricity).toBe(0);
  });

  it('keeps a published eccentricity, including exactly zero', () => {
    expect(resolveOrbitalElements({ semiMajorAxisAu: 2, eccentricity: 0.35 }).eccentricity).toBe(0.35);
    expect(resolveOrbitalElements({ semiMajorAxisAu: 2, eccentricity: 0 }).eccentricity).toBe(0);
  });

  it('produces a genuine circle, not a degenerate ellipse', () => {
    const elements = resolveOrbitalElements({ semiMajorAxisAu: 2 });
    const radii = orbitEllipsePoints(elements).map((point) => Math.hypot(point.x, point.y, point.z));

    for (const radius of radii) {
      expect(radius).toBeCloseTo(2, 9);
    }
  });
});
