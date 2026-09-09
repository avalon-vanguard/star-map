import { describe, expect, it } from 'vitest';

import { buildStarNameIndex, normalizeStarName, resolveHostStarId } from './host-star-matching';
import { propagateProperMotion, raDegDecDistanceToXyz } from './coordinates';
import { StarRecord } from '../models/star.model';

function star(id: number, name: string, raDeg: number, decDeg: number, distancePc: number): StarRecord {
  return { id, name, ...raDegDecDistanceToXyz(raDeg, decDeg, distancePc), magnitude: 10, spectralType: 'M', colorIndex: 1.0 };
}

// A small fixture standing in for a slice of the star catalogue, used to exercise the
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
    const id = resolveHostStarId({ hostname: 'Proxima Centauri', raDeg: NaN, decDeg: NaN, distancePc: NaN }, FIXTURE_STARS);

    expect(id).toBe(1);
  });

  it('matches by name regardless of case/spacing differences', () => {
    const id = resolveHostStarId({ hostname: 'gj3512', raDeg: NaN, decDeg: NaN, distancePc: NaN }, FIXTURE_STARS);

    expect(id).toBe(3);
  });

  it('returns null when there is no name match and no position is available', () => {
    const id = resolveHostStarId({ hostname: 'Unknown Star XYZ', raDeg: NaN, decDeg: NaN, distancePc: NaN }, FIXTURE_STARS);

    expect(id).toBeNull();
  });

  describe('matching on the sky', () => {
    // GJ 887's archive row: position at Gaia's epoch, carried by 6.9″/yr of proper motion —
    // 110″ from where the catalogue has the star at J2000. The matcher must carry the query
    // back those sixteen years itself.
    it('matches a host published at the Gaia epoch to its star at J2000', () => {
      const lacaille9352 = star(70, 'Lacaille 9352', 346.46683, -35.85306, 3.29);
      const archive = propagateProperMotion(346.46683, -35.85306, 6768.2, 1327.52, 16);

      const id = resolveHostStarId(
        { hostname: 'GJ 887', raDeg: archive.raDeg, decDeg: archive.decDeg, distancePc: 3.28679, pmRaMasPerYear: 6768.2, pmDecMasPerYear: 1327.52 },
        [lacaille9352]
      );

      expect(id).toBe(70);
    });

    // alf Tau's archive row publishes J2000 outright, and the archive never says which epoch a
    // row is at. If the matcher trusted one epoch and carried every query back, Aldebaran's
    // planet would land on the Gliese entry sitting 3″ from the carried-back point; the raw
    // position, zero arcseconds from Aldebaran itself, has to win.
    it('keeps a host published at J2000 on its star, proper motion or not', () => {
      const aldebaran = star(80, 'Aldebaran', 68.980163, 16.509302, 20.43);
      const carried = propagateProperMotion(68.980163, 16.509302, 63, -189, -16);
      const ghost = star(81, 'Gl 171.1B', carried.raDeg, carried.decDeg + 3 / 3600, 20.43);

      const id = resolveHostStarId(
        { hostname: 'alf Tau', raDeg: 68.980163, decDeg: 16.509302, distancePc: 20.43, pmRaMasPerYear: 63, pmDecMasPerYear: -189 },
        [ghost, aldebaran]
      );

      expect(id).toBe(80);
    });

    // GJ 15 A's archive row sits at J2016, 46″ along its proper motion from Groombridge 34's
    // J2000 place — and only 16″ from an unrelated Gaia entry. Nearest-to-the-published-point
    // picks the interloper; carrying the query back the sixteen years must put the planets on
    // the star that actually moved there.
    it('picks the star the proper motion says the query is, not the entry nearest the published point', () => {
      const primary = star(90, 'Groombridge 34', 4.595364, 44.022955, 3.562);
      const published = propagateProperMotion(4.595364, 44.022955, 2891.5, 411.9, 16);
      const interloper = star(91, 'Gaia DR3 385334196532776576', published.raDeg, published.decDeg + 16 / 3600, 3.563);

      const id = resolveHostStarId(
        { hostname: 'GJ 15 A', raDeg: published.raDeg, decDeg: published.decDeg, distancePc: 3.56228, pmRaMasPerYear: 2891.5, pmDecMasPerYear: 411.9 },
        [interloper, primary]
      );

      expect(id).toBe(90);
    });

    // GJ 273 is Luyten's Star to the arcsecond, but the archive publishes 5.92 pc for a star
    // at 3.79 — a 56% disagreement. Direction alone must not override a distance in flat
    // contradiction, or every line-of-sight coincidence becomes a match.
    it('refuses a host whose distance flatly contradicts the star it points at', () => {
      const luytens = star(100, "Luyten's Star", 111.8496, 5.2258, 3.79);

      const id = resolveHostStarId({ hostname: 'GJ 273', raDeg: 111.8496, decDeg: 5.2258, distancePc: 5.921535 }, [luytens]);

      expect(id).toBeNull();
    });

    // The tolerance is transverse — parsecs on the sky, not an angle — so the same 15″ offset
    // is a match at 50 pc and a stranger at 200 pc.
    it('scales the angular tolerance with the host distance', () => {
      const at200 = resolveHostStarId(
        { hostname: 'Unmatched', raDeg: 150, decDeg: -40 + 15 / 3600, distancePc: 200 },
        [star(110, 'Far', 150, -40, 200)]
      );
      const at50 = resolveHostStarId(
        { hostname: 'Unmatched', raDeg: 150, decDeg: -40 + 15 / 3600, distancePc: 50 },
        [star(111, 'Near', 150, -40, 50)]
      );

      expect(at200).toBeNull();
      expect(at50).toBe(111);
    });

    it('reuses a prebuilt name index when given one', () => {
      const nameIndex = buildStarNameIndex(FIXTURE_STARS);

      const id = resolveHostStarId({ hostname: 'Sirius', raDeg: NaN, decDeg: NaN, distancePc: NaN }, [], nameIndex);

      expect(id).toBe(2);
    });
  });

  describe('missing distance column', () => {
    // The Exoplanet Archive leaves `sy_dist` blank for some systems. `Number('')` is `0` —
    // finite, so it slips past a naive guard — which puts the host at the origin and matches
    // the Sun at distance 0. That shipped 127 alien planets, all seven TRAPPIST-1 worlds among
    // them, into our own solar system.
    it('does not match a host with a zero distance to the Sun', () => {
      const id = resolveHostStarId({ hostname: 'TRAPPIST-1', raDeg: 346.6, decDeg: -5.04, distancePc: 0 }, FIXTURE_STARS);

      expect(id).toBeNull();
    });

    it('rejects a negative distance too', () => {
      const id = resolveHostStarId({ hostname: 'Nowhere', raDeg: 10, decDeg: 10, distancePc: -3 }, FIXTURE_STARS);

      expect(id).toBeNull();
    });

    it('still matches a real host at a genuinely small distance', () => {
      const id = resolveHostStarId({ hostname: 'Unmatched', raDeg: 217.4, decDeg: -62.68, distancePc: 1.2959 }, FIXTURE_STARS);

      expect(id).toBe(1);
    });

    it('lets a named host resolve even with no usable distance', () => {
      const id = resolveHostStarId({ hostname: 'Sirius', raDeg: 101.3, decDeg: -16.7, distancePc: 0 }, FIXTURE_STARS);

      expect(id).toBe(2);
    });
  });
});
