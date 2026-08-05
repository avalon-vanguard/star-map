import { describe, expect, it } from 'vitest';

import { BYTES_PER_STAR_META, BYTES_PER_STAR_POSITION, decodeStarCatalog, encodeStarCatalog } from './star-catalog';
import { StarRecord } from './star.model';

const STARS: StarRecord[] = [
  { id: 0, name: 'Sol', x: 0, y: 0, z: 0, magnitude: -26.7, spectralType: 'G2V', colorIndex: 0.656 },
  { id: 71456, name: 'Rigil Kentaurus', x: -1.35, y: -0.04, z: -0.98, magnitude: -0.01, spectralType: 'G2V', colorIndex: 0.71 },
  { id: 32263, name: 'Sirius', x: -0.49, y: 2.47, z: -0.75, magnitude: -1.44, spectralType: 'A0m...', colorIndex: 0.009 },
  // The case a plain number cannot carry: about a tenth of the catalogue was never photometered.
  { id: 118554, name: 'GJ 3512', x: 20.1, y: -3.4, z: 8.8, magnitude: 15, spectralType: 'Unknown', colorIndex: null }
];

describe('encodeStarCatalog / decodeStarCatalog', () => {
  const encoded = encodeStarCatalog(STARS);
  const decoded = decodeStarCatalog(encoded.index, encoded.positions, encoded.meta);

  it('round-trips every field of every star', () => {
    expect(decoded).toHaveLength(STARS.length);
    decoded.forEach((star, index) => {
      const original = STARS[index];
      expect(star.id).toBe(original.id);
      expect(star.name).toBe(original.name);
      expect(star.spectralType).toBe(original.spectralType);
      expect(star.x).toBeCloseTo(original.x, 4);
      expect(star.y).toBeCloseTo(original.y, 4);
      expect(star.z).toBeCloseTo(original.z, 4);
      expect(star.magnitude).toBeCloseTo(original.magnitude, 4);
    });
  });

  it('carries an absent colour index through as null, not as zero', () => {
    // Zero is a real colour index meaning a hot blue-white A-type star, so it cannot double as
    // "not measured" — the float column uses NaN, which nothing else can be.
    expect(decoded[3].colorIndex).toBeNull();
    expect(decoded[0].colorIndex).toBeCloseTo(0.656, 5);
    expect(decoded[2].colorIndex).toBeCloseTo(0.009, 5);
  });

  it('sizes both binaries exactly to the star count', () => {
    expect(encoded.positions.byteLength).toBe(STARS.length * BYTES_PER_STAR_POSITION);
    expect(encoded.meta.byteLength).toBe(STARS.length * BYTES_PER_STAR_META);
  });

  it('hands positions over as a bare xyz buffer, which is what the GPU is given', () => {
    expect(Array.from(encoded.positions.slice(0, 3))).toEqual([0, 0, 0]);
    expect(encoded.positions[3]).toBeCloseTo(-1.35, 4);
  });

  it('stores each distinct spectral type once and refers to it by index', () => {
    // Two of the four stars are G2V. Across the real catalogue this is 68000 stars sharing
    // about 2600 strings, which is why the dictionary is worth having.
    expect(encoded.index.spectralTypes).toEqual(['G2V', 'A0m...', 'Unknown']);
  });

  it('keeps the index free of anything that is not a string, since the numbers are elsewhere', () => {
    expect(Object.keys(encoded.index).sort()).toEqual(['count', 'names', 'spectralTypes']);
    expect(encoded.index.count).toBe(STARS.length);
    expect(encoded.index.names).toEqual(STARS.map((star) => star.name));
  });

  it('is smaller than the array of objects it replaced', () => {
    // The whole reason for the format: the old encoding repeated eight key names per star.
    const asObjects = JSON.stringify(STARS).length;
    const asCatalogue = JSON.stringify(encoded.index).length + encoded.positions.byteLength + encoded.meta.byteLength;
    expect(asCatalogue).toBeLessThan(asObjects);
  });

  it('handles an empty catalogue without producing a malformed buffer', () => {
    const empty = encodeStarCatalog([]);
    expect(empty.positions.byteLength).toBe(0);
    expect(empty.meta.byteLength).toBe(0);
    expect(decodeStarCatalog(empty.index, empty.positions, empty.meta)).toEqual([]);
  });

  it('survives more distinct spectral types than a handful, up to the column width', () => {
    // The dictionary index is 16-bit, and the real catalogue has about 2600 distinct types.
    const many: StarRecord[] = Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      name: `HYG ${i}`,
      x: i,
      y: 0,
      z: 0,
      magnitude: 10,
      spectralType: `S${i}`,
      colorIndex: null
    }));
    const round = decodeStarCatalog(...(({ index, positions, meta }) => [index, positions, meta] as const)(encodeStarCatalog(many)));

    expect(round[4999].spectralType).toBe('S4999');
    expect(round[4999].id).toBe(4999);
  });
});
