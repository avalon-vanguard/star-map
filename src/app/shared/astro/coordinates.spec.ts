import { describe, expect, it } from 'vitest';

import { distanceBetween, parallaxMasToParsecs, raDecDistanceToXyz, raDegDecDistanceToXyz } from './coordinates';

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
