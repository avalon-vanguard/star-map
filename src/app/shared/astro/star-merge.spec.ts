import { describe, expect, it } from 'vitest';

import { raDegDecDistanceToXyz } from './coordinates';
import { StarRecord } from '../models/star.model';
import { directionCosine, isSameStar, MERGE_ANGULAR_TOLERANCE_DEG, mergeStarCatalogues } from './star-merge';

/** A star at a given sky position and distance, which is how catalogues actually report them. */
function at(id: number, raDeg: number, decDeg: number, distancePc: number, overrides: Partial<StarRecord> = {}): StarRecord {
  const { x, y, z } = raDegDecDistanceToXyz(raDeg, decDeg, distancePc);
  return { id, name: `star-${id}`, x, y, z, magnitude: 5, spectralType: 'G2V', colorIndex: 0.6, ...overrides };
}

const HIPPARCOS = { sourceId: 'hyg', parallaxPrecisionMas: 1 };
const GAIA = { sourceId: 'gaia', parallaxPrecisionMas: 0.02 };

/** Degrees of right ascension that span `arcsec` on the sky at declination `decDeg`. */
function arcsecOfRa(arcsec: number, decDeg: number): number {
  return arcsec / 3600 / Math.cos((decDeg * Math.PI) / 180);
}

describe('isSameStar', () => {
  it('matches two catalogues reporting the same star', () => {
    expect(isSameStar(at(1, 101.28, -16.71, 2.64), at(2, 101.28, -16.71, 2.63))).toBe(true);
  });

  it('matches within the angular tolerance and not beyond it', () => {
    const toleranceArcsec = MERGE_ANGULAR_TOLERANCE_DEG * 3600;
    expect(isSameStar(at(1, 200, 10, 100), at(2, 200 + arcsecOfRa(0.9 * toleranceArcsec, 10), 10, 100))).toBe(true);
    expect(isSameStar(at(1, 200, 10, 100), at(2, 200 + arcsecOfRa(1.1 * toleranceArcsec, 10), 10, 100))).toBe(false);
  });

  it('tolerates the distance disagreement two parallaxes actually have', () => {
    // Hipparcos and Gaia routinely differ by tens of per cent at a few hundred parsecs. That
    // disagreement is the reason to prefer one of them, not evidence they are different stars.
    expect(isSameStar(at(1, 200, 10, 200), at(2, 200, 10, 260))).toBe(true);
  });

  it('keeps a bright primary out of the entry of its faint companion', () => {
    // Gaia has no Sirius — it saturates — but has Sirius B, 6″ away at the same distance and ten
    // magnitudes fainter. Direction and distance say "same star"; the brightness says otherwise.
    const siriusB = at(1, 101.2875, -16.7161, 2.67, { name: 'Gaia DR3 2947050466531873024', magnitude: 8.5, source: 'gaia' });
    const sirius = at(32263, 101.2875 + arcsecOfRa(6.1, -16.7161), -16.7161, 2.637, { name: 'Sirius', magnitude: -1.44 });
    expect(isSameStar(siriusB, sirius)).toBe(false);
    expect(isSameStar(siriusB, { ...sirius, magnitude: 8.6 })).toBe(true);
  });

  it('lets the folded entry be fainter, as a red star is in V, but not much brighter', () => {
    // Wolf 359 is V 13.45 in HYG and G 11.0 in Gaia — the same star, 5″ apart on a Gliese
    // position. Almach is V 2.1 and sits 10″ from γ² And, G 4.9: Gaia has no Almach, and its
    // name must not land on the companion.
    const wolf359 = at(1, 164.1, 7.0, 2.41, { name: 'Gaia DR3 3864972938605115520', magnitude: 11.0, source: 'gaia' });
    expect(isSameStar(wolf359, at(118720, 164.1 + arcsecOfRa(5, 7), 7.0, 2.39, { name: 'Wolf 359', magnitude: 13.45 }))).toBe(true);
    const gamma2And = at(2, 30.97, 42.33, 50, { name: 'Gaia DR3 346231302441905920', magnitude: 4.9, source: 'gaia' });
    expect(isSameStar(gamma2And, at(9640, 30.97 + arcsecOfRa(9.9, 42.33), 42.33, 50, { name: 'Almach', magnitude: 2.1 }))).toBe(false);
  });

  it('does not match two different stars that happen to be at the same distance', () => {
    expect(isSameStar(at(1, 200, 10, 200), at(2, 200.5, 10, 200))).toBe(false);
  });

  it('takes two entries within three arcseconds for one star, whatever their distances say', () => {
    // HD 225021: 143.7 pc by its Hipparcos parallax, 239.4 by Gaia's, 0.01″ apart; HIP 82724:
    // 3.7 pc by Hipparcos, 62.8 by Gaia, 2.3″ apart. A coincidence of direction that close is
    // never chance at this depth; the parallax is what is wrong.
    const gaia = at(1, 1.72, -8.9, 239.4, { name: 'Gaia DR3 395581679270412160', source: 'gaia' });
    expect(isSameStar(gaia, at(213, 1.72 + arcsecOfRa(0.1, -8.9), -8.9, 143.7, { name: 'HD 225021' }))).toBe(true);
    expect(isSameStar(at(2, 253.6, -38.1, 62.8, { source: 'gaia' }), at(82724, 253.6 + arcsecOfRa(2.3, -38.1), -38.1, 3.7))).toBe(true);
  });

  it('past those three arcseconds, does not match along a line of sight when the distances conflict', () => {
    // Nearly the same direction, one three times further away: a background star, not the same object.
    expect(isSameStar(at(1, 200, 10, 100), at(2, 200 + arcsecOfRa(5, 10), 10, 300))).toBe(false);
  });

  it('still hears the brightness inside those three arcseconds', () => {
    // Ashlesha (ε Hya, V 3.38) has a companion 2.7″ away that Gaia does carry, three magnitudes
    // fainter, while it does not carry Ashlesha. Direction alone would put the name on the companion.
    const companion = at(1, 131.69, 6.42, 40, { name: 'Gaia DR3 1', magnitude: 6.7, source: 'gaia' });
    expect(isSameStar(companion, at(43109, 131.69 + arcsecOfRa(2.7, 6.42), 6.42, 40, { name: 'Ashlesha', magnitude: 3.38 }))).toBe(false);
  });

  it('matches on direction rather than on 3D proximity', () => {
    // The distinction the merge rests on. These two are 60 pc apart in space and are the same
    // star; a 3D-proximity test would have to be so loose it swallowed real neighbours.
    const a = at(1, 45, 20, 200);
    const b = at(2, 45, 20, 260);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(50);
    expect(isSameStar(a, b)).toBe(true);
  });

  it('treats two stars at the origin as the same, and one at the origin as unlike any other', () => {
    const origin: StarRecord = { id: 0, name: 'Sol', x: 0, y: 0, z: 0, magnitude: -26.7, spectralType: 'G2V', colorIndex: 0.65 };
    expect(isSameStar(origin, { ...origin, id: 1 })).toBe(true);
    expect(isSameStar(origin, at(2, 45, 20, 10))).toBe(false);
  });
});

describe('directionCosine', () => {
  it('is one for the same direction and stays inside the domain of acos', () => {
    expect(directionCosine(at(1, 45, 20, 5), at(2, 45, 20, 500))).toBeCloseTo(1, 12);
    expect(Math.abs(directionCosine(at(1, 45, 20, 5), at(2, 225, -20, 5)))).toBeLessThanOrEqual(1);
  });
});

describe('mergeStarCatalogues', () => {
  it('keeps the better-measured catalogue where two overlap', () => {
    // Gaia's parallax is fifty times more precise, so where both have a star, its position is
    // Gaia's — regardless of which catalogue was passed first.
    const shared = { raDeg: 101.28, decDeg: -16.71 };
    const { stars, summary } = mergeStarCatalogues([
      { ...HIPPARCOS, stars: [at(1, shared.raDeg, shared.decDeg, 2.7)] },
      { ...GAIA, stars: [at(2, shared.raDeg, shared.decDeg, 2.64)] }
    ]);

    expect(stars).toHaveLength(1);
    expect(stars[0].id).toBe(2);
    expect(stars[0].source).toBe('gaia');
    expect(summary.duplicates).toBe(1);
  });

  it('gives a matched star the better position and the name somebody gave it', () => {
    // What a merge is for: Gaia knows where Proxima is to a fraction of a milliarcsecond and
    // calls it by a nineteen-digit number; HYG knows its name, its spectral type and its V
    // magnitude. Keeping one row whole loses half of that either way. The id follows the
    // description, so a star HYG knows keeps its HYG id from one refresh to the next.
    const hyg = at(70666, 217.4289, -62.6795, 1.2959, { name: 'Proxima Centauri', spectralType: 'M5Ve', magnitude: 11.01, colorIndex: 1.807 });
    const gaia = at(1000064182, 217.4289, -62.6795, 1.302, { name: 'Gaia DR3 5853498713190525696', spectralType: 'Unknown', magnitude: 8.985, colorIndex: 3.805, source: 'gaia' });
    const { stars, summary } = mergeStarCatalogues([{ ...HIPPARCOS, stars: [hyg] }, { ...GAIA, stars: [gaia] }]);

    expect(stars).toEqual([{ ...hyg, x: gaia.x, y: gaia.y, z: gaia.z, source: 'gaia' }]);
    expect(summary.duplicates).toBe(1);
  });

  it('keeps two entries of one source apart, however close they are', () => {
    // Gaia resolves doubles Hipparcos saw as one star: two source ids 0.8″ apart are two stars,
    // and only *another* catalogue can claim to have already listed either of them.
    const { stars, summary } = mergeStarCatalogues([{ ...GAIA, stars: [at(1, 10, 10, 100), at(2, 10 + arcsecOfRa(0.8, 10), 10, 100)] }]);
    expect(stars).toHaveLength(2);
    expect(summary.duplicates).toBe(0);
  });

  it('folds an entry into the nearest match, and into each match once', () => {
    // Gliese lists both components of a double; Gaia resolves them 0.8″ apart. Each HYG
    // component must land on its own Gaia counterpart — not both on whichever the grid yields
    // first, and not both on the same one.
    const gaiaA = at(1, 10, 10, 2.68, { name: 'Gaia DR3 1', source: 'gaia' });
    const gaiaB = at(2, 10 + arcsecOfRa(0.8, 10), 10, 2.68, { name: 'Gaia DR3 2', source: 'gaia' });
    const a = at(118079, 10, 10, 2.63, { name: 'Gl 65A' });
    const b = at(118080, 10 + arcsecOfRa(0.8, 10), 10, 2.63, { name: 'Gl 65B' });
    const position = (star: StarRecord) => [star.x, star.y, star.z];

    const nearest = mergeStarCatalogues([{ ...HIPPARCOS, stars: [b, a] }, { ...GAIA, stars: [gaiaA, gaiaB] }]);
    expect(nearest.stars.map((star) => [star.name, ...position(star)])).toEqual([['Gl 65A', ...position(gaiaA)], ['Gl 65B', ...position(gaiaB)]]);

    const onePlace = mergeStarCatalogues([{ ...HIPPARCOS, stars: [a, { ...b, x: a.x, y: a.y, z: a.z }] }, { ...GAIA, stars: [gaiaA, gaiaB] }]);
    expect(onePlace.stars.map((star) => [star.name, ...position(star)])).toEqual([['Gl 65A', ...position(gaiaA)], ['Gl 65B', ...position(gaiaB)]]);
  });

  it('keeps a star the better catalogue does not reach', () => {
    // The point of merging rather than replacing: Gaia is more precise but not a superset of
    // everything, and a bright star it omits should not vanish from the map.
    const { stars } = mergeStarCatalogues([
      { ...HIPPARCOS, stars: [at(1, 10, 10, 100)] },
      { ...GAIA, stars: [at(2, 200, -30, 50)] }
    ]);

    expect(stars.map((star) => star.id).sort()).toEqual([1, 2]);
    expect(stars.find((star) => star.id === 1)?.source).toBe('hyg');
  });

  it('records where every star came from', () => {
    const { stars, summary } = mergeStarCatalogues([
      { ...HIPPARCOS, stars: [at(1, 10, 10, 100), at(3, 20, 10, 100)] },
      { ...GAIA, stars: [at(2, 200, -30, 50)] }
    ]);

    expect(summary.bySource).toEqual({ hyg: 2, gaia: 1 });
    expect(new Set(stars.map((star) => star.source))).toEqual(new Set(['hyg', 'gaia']));
  });

  it('does not depend on the order the catalogues were given in', () => {
    const shared = [at(1, 30, 5, 80)];
    const better = [at(2, 30, 5, 79)];
    const forwards = mergeStarCatalogues([{ ...HIPPARCOS, stars: shared }, { ...GAIA, stars: better }]);
    const backwards = mergeStarCatalogues([{ ...GAIA, stars: better }, { ...HIPPARCOS, stars: shared }]);

    expect(forwards.stars.map((s) => s.id)).toEqual(backwards.stars.map((s) => s.id));
  });

  it('leaves a star that already names its source alone', () => {
    const { stars } = mergeStarCatalogues([{ ...GAIA, stars: [at(1, 10, 10, 100, { source: 'gaia-dr4' })] }]);
    expect(stars[0].source).toBe('gaia-dr4');
  });

  it('finds duplicates that straddle a sky-grid boundary', () => {
    // The bucketing is an optimisation, and an optimisation that changes the answer is a bug.
    // Every one of these sits on or beside a cell edge.
    for (const [raDeg, decDeg] of [
      [0, 0],
      [0.5, 0.5],
      [359.999, -0.0001],
      [180, 89.9]
    ]) {
      const { stars } = mergeStarCatalogues([
        { ...HIPPARCOS, stars: [at(1, raDeg, decDeg, 100)] },
        { ...GAIA, stars: [at(2, raDeg, decDeg, 100)] }
      ]);
      expect(stars).toHaveLength(1);
    }

    // And the one edge the grid has to wrap: 3.6″ apart, either side of 0h.
    const { stars } = mergeStarCatalogues([
      { ...HIPPARCOS, stars: [at(1, 359.9995, 0, 100)] },
      { ...GAIA, stars: [at(2, 0.0005, 0, 100)] }
    ]);
    expect(stars).toHaveLength(1);
  });

  it('handles a single catalogue as a plain pass-through', () => {
    const { stars, summary } = mergeStarCatalogues([{ ...HIPPARCOS, stars: [at(1, 10, 10, 100), at(2, 20, 20, 100)] }]);
    expect(stars).toHaveLength(2);
    expect(summary.duplicates).toBe(0);
  });

  it('handles no catalogues at all', () => {
    expect(mergeStarCatalogues([]).stars).toEqual([]);
  });

  it('scales to catalogues large enough to matter', () => {
    // The reason for the sky grid: the naive pairwise merge is quadratic, and these surveys are
    // the size where that stops being an academic point.
    const many = Array.from({ length: 20000 }, (_, i) => at(i, (i * 0.017) % 360, ((i * 0.031) % 160) - 80, 100));
    const started = Date.now();
    const { stars } = mergeStarCatalogues([{ ...HIPPARCOS, stars: many }, { ...GAIA, stars: many.map((s) => ({ ...s, id: s.id + 100000 })) }]);

    expect(stars).toHaveLength(20000);
    expect(Date.now() - started).toBeLessThan(10000);
  });
});
