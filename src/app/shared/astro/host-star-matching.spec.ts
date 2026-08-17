import { describe, expect, it } from 'vitest';

import { buildStarNameIndex, normalizeStarName, resolveHostStarId } from './host-star-matching';
import { StarRecord } from '../models/star.model';

// A small fixture standing in for a slice of the HYG star index, used to exercise the
// exoplanet host-star cross-referencing logic without hitting any real API.
const FIXTURE_STARS: StarRecord[] = [
  // The Sun sits at the origin, exactly where a host with a missing distance lands.
  { id: 0, name: 'Sol', x: 0, y: 0, z: 0, magnitude: -26.7, spectralType: 'G2V', colorIndex: 0.656 },
  { id: 1, name: 'Proxima Centauri', x: -0.472264, y: -0.361451, z: -1.151219, magnitude: 11.01, spectralType: 'M5Ve', colorIndex: 1.807 },
  { id: 2, name: 'Sirius', x: -0.494323, y: 2.476731, z: -0.758485, magnitude: -1.44, spectralType: 'A0m...', colorIndex: 0.009 },
  { id: 3, name: 'GJ 3512', x: 3.0, y: 4.0, z: 5.0, magnitude: 11.0, spectralType: 'M5.5', colorIndex: 1.6 }
];

describe('normalizeStarName', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(normalizeStarName('GJ 3512')).toBe('gj3512');
    expect(normalizeStarName('Proxima Centauri')).toBe('proximacentauri');
  });
});

describe('resolveHostStarId', () => {
  it('matches by exact (normalized) host star name', () => {
    const id = resolveHostStarId({ hostname: 'Proxima Centauri', raDeg: NaN, decDeg: NaN, distancePc: NaN }, FIXTURE_STARS, 0.5);

    expect(id).toBe(1);
  });

  it('matches by name regardless of case/spacing differences', () => {
    const id = resolveHostStarId({ hostname: 'gj3512', raDeg: NaN, decDeg: NaN, distancePc: NaN }, FIXTURE_STARS, 0.5);

    expect(id).toBe(3);
  });

  it('falls back to nearest-neighbour position matching when the name is unknown', () => {
    // Slightly off from Sirius's exact position, within tolerance.
    const id = resolveHostStarId({ hostname: 'Sirius A', raDeg: 101.29, decDeg: -16.72, distancePc: 2.64 }, FIXTURE_STARS, 0.5);

    expect(id).toBe(2);
  });

  it('returns null when no name match and no star is within tolerance', () => {
    const id = resolveHostStarId({ hostname: 'Unknown Star XYZ', raDeg: 0, decDeg: 0, distancePc: 100 }, FIXTURE_STARS, 0.5);

    expect(id).toBeNull();
  });

  it('returns null when there is no name match and no position is available', () => {
    const id = resolveHostStarId({ hostname: 'Unknown Star XYZ', raDeg: NaN, decDeg: NaN, distancePc: NaN }, FIXTURE_STARS, 0.5);

    expect(id).toBeNull();
  });

  it('picks the closest star when more than one falls within tolerance', () => {
    const stars: StarRecord[] = [
      { id: 10, name: 'Near', x: 0, y: 0, z: 0, magnitude: 5, spectralType: 'G', colorIndex: 0.5 },
      { id: 11, name: 'Far', x: 0.4, y: 0, z: 0, magnitude: 5, spectralType: 'G', colorIndex: 0.5 }
    ];
    const nameIndex = buildStarNameIndex(stars);

    const id = resolveHostStarId({ hostname: 'Unmatched', raDeg: 0, decDeg: 0, distancePc: 0.2 }, stars, 0.5, nameIndex);

    expect(id).toBe(10);
  });

  describe('missing distance column', () => {
    // The Exoplanet Archive leaves `sy_dist` blank for some systems. `Number('')` is `0` —
    // finite, so it slips past a naive guard — which puts the host at the origin and matches
    // the Sun at distance 0. That shipped 127 alien planets, all seven TRAPPIST-1 worlds among
    // them, into our own solar system.
    it('does not match a host with a zero distance to the Sun', () => {
      const id = resolveHostStarId({ hostname: 'TRAPPIST-1', raDeg: 346.6, decDeg: -5.04, distancePc: 0 }, FIXTURE_STARS, 0.5);

      expect(id).toBeNull();
    });

    it('rejects a negative distance too', () => {
      const id = resolveHostStarId({ hostname: 'Nowhere', raDeg: 10, decDeg: 10, distancePc: -3 }, FIXTURE_STARS, 0.5);

      expect(id).toBeNull();
    });

    it('still matches a real host at a genuinely small distance', () => {
      const id = resolveHostStarId({ hostname: 'Unmatched', raDeg: 217.4, decDeg: -62.68, distancePc: 1.2959 }, FIXTURE_STARS, 0.5);

      expect(id).toBe(1);
    });

    it('lets a named host resolve even with no usable distance', () => {
      const id = resolveHostStarId({ hostname: 'Sirius', raDeg: 101.3, decDeg: -16.7, distancePc: 0 }, FIXTURE_STARS, 0.5);

      expect(id).toBe(2);
    });
  });
});
