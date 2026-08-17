import { describe, expect, it } from 'vitest';

import {
  distanceBetween,
  eclipticToEquatorial,
  equatorialToEcliptic,
  OBLIQUITY_J2000_DEG,
  parallaxMasToParsecs,
  parseSexagesimal,
  raDecDistanceToXyz,
  raDecToUnitVector,
  raDegDecDistanceToXyz
} from './coordinates';

// Reference values taken directly from the HYG v4.1 database (RA/Dec/dist and its own
// precomputed x/y/z, which uses the same equatorial-Cartesian convention we implement).
describe('raDecDistanceToXyz', () => {
  it('matches the HYG reference position for Sirius', () => {
    const result = raDecDistanceToXyz(6.752481, -16.716116, 2.6371);

    expect(result.x).toBeCloseTo(-0.494323, 3);
    expect(result.y).toBeCloseTo(2.476731, 3);
    expect(result.z).toBeCloseTo(-0.758485, 3);
  });

  it('matches the HYG reference position for Proxima Centauri', () => {
    const result = raDecDistanceToXyz(14.495985, -62.679485, 1.2959);

    expect(result.x).toBeCloseTo(-0.472264, 3);
    expect(result.y).toBeCloseTo(-0.361451, 3);
    expect(result.z).toBeCloseTo(-1.151219, 3);
  });

  it('places a star on RA 6h / Dec 0 entirely on the +Y axis', () => {
    const result = raDecDistanceToXyz(6, 0, 10);

    expect(result.x).toBeCloseTo(0, 9);
    expect(result.y).toBeCloseTo(10, 9);
    expect(result.z).toBeCloseTo(0, 9);
  });

  it('places the vernal equinox direction entirely on the +X axis', () => {
    const result = raDecDistanceToXyz(0, 0, 10);

    expect(result.x).toBeCloseTo(10, 9);
    expect(result.y).toBeCloseTo(0, 9);
    expect(result.z).toBeCloseTo(0, 9);
  });
});

describe('raDegDecDistanceToXyz', () => {
  it('is equivalent to raDecDistanceToXyz with RA converted from degrees to hours', () => {
    const fromHours = raDecDistanceToXyz(6.752481, -16.716116, 2.6371);
    const fromDegrees = raDegDecDistanceToXyz(6.752481 * 15, -16.716116, 2.6371);

    expect(fromDegrees.x).toBeCloseTo(fromHours.x, 9);
    expect(fromDegrees.y).toBeCloseTo(fromHours.y, 9);
    expect(fromDegrees.z).toBeCloseTo(fromHours.z, 9);
  });
});

describe('parallaxMasToParsecs', () => {
  it('converts a positive parallax to the expected distance', () => {
    expect(parallaxMasToParsecs(769.33)).toBeCloseTo(1.3, 2); // Proxima Centauri
  });

  it('returns Infinity for zero or negative parallax', () => {
    expect(parallaxMasToParsecs(0)).toBe(Infinity);
    expect(parallaxMasToParsecs(-5)).toBe(Infinity);
  });
});

describe('distanceBetween', () => {
  it('computes the Euclidean distance between two points', () => {
    expect(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBeCloseTo(5, 9);
  });
});

describe('raDecToUnitVector', () => {
  it('always returns a unit-length vector', () => {
    for (const [ra, dec] of [
      [0, 0],
      [6, 45],
      [13.7, -62.7],
      [23.99, 89.9]
    ]) {
      const { x, y, z } = raDecToUnitVector(ra, dec);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    }
  });

  it('points along +Z at the north celestial pole', () => {
    const { x, y, z } = raDecToUnitVector(0, 90);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(1, 12);
  });

  it('agrees with the distance-carrying conversion, scaled', () => {
    const unit = raDecToUnitVector(6.752481, -16.716116);
    const scaled = raDecDistanceToXyz(6.752481, -16.716116, 2.6371);

    expect(unit.x * 2.6371).toBeCloseTo(scaled.x, 12);
    expect(unit.y * 2.6371).toBeCloseTo(scaled.y, 12);
    expect(unit.z * 2.6371).toBeCloseTo(scaled.z, 12);
  });
});

describe('parseSexagesimal', () => {
  it('parses a right ascension into decimal hours', () => {
    // 00:08:27.05 = 8/60 + 27.05/3600 hours
    expect(parseSexagesimal('00:08:27.05')).toBeCloseTo(0.140847, 6);
  });

  it('parses a positive declination into decimal degrees', () => {
    expect(parseSexagesimal('+27:43:03.6')).toBeCloseTo(27.7176667, 6);
  });

  it('parses a negative declination', () => {
    expect(parseSexagesimal('-12:49:22.3')).toBeCloseTo(-12.8228611, 6);
  });

  it('keeps the sign for a negative angle inside the first degree', () => {
    // The trap: `Number('-00')` is `-0`, which is `=== 0`, so a naive implementation flips
    // this object into the northern hemisphere.
    const parsed = parseSexagesimal('-00:24:54.8');
    expect(parsed).toBeLessThan(0);
    expect(parsed).toBeCloseTo(-0.4152222, 6);
  });

  it('treats an unsigned angle as positive', () => {
    expect(parseSexagesimal('00:24:54.8')).toBeCloseTo(0.4152222, 6);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseSexagesimal('  +27:43:03.6  ')).toBeCloseTo(27.7176667, 6);
  });

  it('returns null for missing or malformed values', () => {
    for (const input of ['', '   ', 'not-an-angle', '12:34', '12:34:56:78', '12;34;56', undefined, null]) {
      expect(parseSexagesimal(input)).toBeNull();
    }
  });

  it('returns null rather than a partial value for empty sub-fields', () => {
    expect(parseSexagesimal('12::56')).toBeNull();
  });
});

describe('eclipticToEquatorial', () => {
  const RAD = Math.PI / 180;

  it('leaves the vernal equinox untouched, since both frames share that axis', () => {
    // +X is where the ecliptic crosses the celestial equator, so it is the rotation axis.
    expect(eclipticToEquatorial({ x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('puts the ecliptic pole the obliquity away from the celestial pole', () => {
    const pole = eclipticToEquatorial({ x: 0, y: 0, z: 1 });
    const angleFromCelestialPoleDeg = Math.acos(pole.z) / RAD;

    expect(angleFromCelestialPoleDeg).toBeCloseTo(OBLIQUITY_J2000_DEG, 9);
    expect(pole.x).toBeCloseTo(0, 12);
    expect(pole.y).toBeCloseTo(-Math.sin(OBLIQUITY_J2000_DEG * RAD), 12);
  });

  it('places the summer solstice point at the obliquity in declination', () => {
    // Ecliptic longitude 90 degrees is the northernmost point of the Sun's yearly path, whose
    // declination is by definition the obliquity — about 23.4 degrees.
    const solstice = eclipticToEquatorial({ x: 0, y: 1, z: 0 });
    const declinationDeg = Math.asin(solstice.z) / RAD;

    expect(declinationDeg).toBeCloseTo(OBLIQUITY_J2000_DEG, 9);
  });

  it('preserves length, being a rotation', () => {
    const rotated = eclipticToEquatorial({ x: 0.3, y: -0.5, z: 0.81 });
    expect(Math.hypot(rotated.x, rotated.y, rotated.z)).toBeCloseTo(Math.hypot(0.3, -0.5, 0.81), 12);
  });

  it('leaves a point in the ecliptic plane in that plane, tilted out of the equator', () => {
    const inPlane = eclipticToEquatorial({ x: 0.6, y: 0.8, z: 0 });
    expect(inPlane.z).toBeCloseTo(0.8 * Math.sin(OBLIQUITY_J2000_DEG * RAD), 12);
  });
});

describe('equatorialToEcliptic', () => {
  it('is the exact inverse of eclipticToEquatorial', () => {
    for (const point of [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: -0.37, y: 0.42, z: 0.83 }
    ]) {
      const round = equatorialToEcliptic(eclipticToEquatorial(point));
      expect(round.x).toBeCloseTo(point.x, 12);
      expect(round.y).toBeCloseTo(point.y, 12);
      expect(round.z).toBeCloseTo(point.z, 12);
    }
  });

  it('brings the celestial pole back to the obliquity off the ecliptic pole', () => {
    const pole = equatorialToEcliptic({ x: 0, y: 0, z: 1 });
    expect(Math.acos(pole.z) / (Math.PI / 180)).toBeCloseTo(OBLIQUITY_J2000_DEG, 9);
  });
});
