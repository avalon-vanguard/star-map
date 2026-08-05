import { describe, expect, it } from 'vitest';

import { ExoplanetRecord } from '../models/exoplanet.model';
import { StarRecord } from '../models/star.model';
import { rematchHostStars } from './host-star-matching';

/** Two catalogue stars, one of which is only present in the wider of the two catalogues. */
const NEARBY: StarRecord = { id: 100, name: 'Gl 357', x: 9, y: 0, z: 0, magnitude: 10.9, spectralType: 'K', colorIndex: 1.4 };
const DISTANT: StarRecord = { id: 200, name: 'HD 33844', x: 0, y: 120, z: 0, magnitude: 7.7, spectralType: 'K0', colorIndex: 1.0 };

const NARROW_CATALOGUE = [NEARBY];
const WIDE_CATALOGUE = [NEARBY, DISTANT];

function planet(overrides: Partial<ExoplanetRecord> = {}): ExoplanetRecord {
  return { id: 'p', hostStarId: null, hostStarName: 'HD 33844', name: 'HD 33844 b', orbit: { semiMajorAxisAu: 1 }, ...overrides };
}

describe('rematchHostStars', () => {
  it('rescues a host that the wider catalogue now contains, by name alone', () => {
    // The whole point: the cross-reference is a fact about the catalogue as much as about the
    // archive, so widening one ought to resolve hosts the other already knew about.
    const planets = [planet()];
    const summary = rematchHostStars(planets, WIDE_CATALOGUE);

    expect(planets[0].hostStarId).toBe(DISTANT.id);
    expect(summary.gained).toBe(1);
    expect(summary.matched).toBe(1);
  });

  it('needs no coordinates to do it', () => {
    // Which matters, because the shipped records were written before coordinates were kept.
    const planets = [planet()];
    expect(planets[0].hostRaDeg).toBeUndefined();
    rematchHostStars(planets, WIDE_CATALOGUE);
    expect(planets[0].hostStarId).toBe(DISTANT.id);
  });

  it('will not clear an existing match on a name miss when it has no coordinates', () => {
    // A name miss says the name missed, not that the star is absent — and the earlier match may
    // have been positional, from data this record no longer carries.
    const planets = [planet({ hostStarId: 999, hostStarName: 'Some Survey Designation' })];
    const summary = rematchHostStars(planets, WIDE_CATALOGUE);

    expect(planets[0].hostStarId).toBe(999);
    expect(summary.lost).toBe(0);
    expect(summary.matched).toBe(1);
  });

  it('takes the new answer outright when the record does carry coordinates', () => {
    // With coordinates the match can be redone in full, so its result is authoritative — a host
    // that no longer resolves is cleared rather than left pointing at a star that may be gone.
    const planets = [planet({ hostStarId: 999, hostStarName: 'Nowhere', hostRaDeg: 10, hostDecDeg: 10, hostDistancePc: 500 })];
    const summary = rematchHostStars(planets, WIDE_CATALOGUE);

    expect(planets[0].hostStarId).toBeNull();
    expect(summary.resolvable).toBe(1);
    expect(summary.lost).toBe(1);
  });

  it('matches a positioned host to the catalogue star at its coordinates', () => {
    const planets = [planet({ hostStarName: 'unlisted alias', hostRaDeg: 90, hostDecDeg: 0, hostDistancePc: 120 })];
    rematchHostStars(planets, WIDE_CATALOGUE);
    expect(planets[0].hostStarId).toBe(DISTANT.id);
  });

  it('leaves a host that neither catalogue contains unmatched', () => {
    const planets = [planet()];
    const summary = rematchHostStars(planets, NARROW_CATALOGUE);

    expect(planets[0].hostStarId).toBeNull();
    expect(summary.matched).toBe(0);
    expect(summary.gained).toBe(0);
  });

  it('counts every record it was given', () => {
    const planets = [planet(), planet({ id: 'q', hostStarName: 'Gl 357' }), planet({ id: 'r', hostStarName: 'nobody' })];
    const summary = rematchHostStars(planets, WIDE_CATALOGUE);

    expect(summary.total).toBe(3);
    expect(summary.matched).toBe(2);
  });
});
