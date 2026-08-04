import { describe, expect, it } from 'vitest';

import { StarRecord } from '../../shared/models/star.model';
import { colorIndexToRgb, StarFieldRenderer } from './star-field-renderer';

function star(overrides: Partial<StarRecord> = {}): StarRecord {
  return {
    id: 1,
    name: 'Test Star',
    x: 0,
    y: 0,
    z: 0,
    magnitude: 5,
    spectralType: 'G2V',
    colorIndex: 0.65,
    ...overrides
  };
}

describe('colorIndexToRgb', () => {
  it('tints a hot, low-index star blue-white', () => {
    const color = colorIndexToRgb(-0.3);
    expect(color.b).toBeGreaterThan(color.r);
  });

  it('tints a cool, high-index star orange-red', () => {
    const color = colorIndexToRgb(1.8);
    expect(color.r).toBeGreaterThan(color.b);
  });

  it('moves monotonically from blue toward red as the index rises', () => {
    const blueness = [-0.3, 0.2, 0.65, 1.2, 1.9].map((index) => {
      const color = colorIndexToRgb(index);
      return color.b - color.r;
    });
    expect([...blueness].sort((a, b) => b - a)).toEqual(blueness);
  });

  describe('when the catalog has no photometry', () => {
    // ~10% of nearby HYG stars have a blank colour-index cell. Reading that as 0 (which is a
    // real index, meaning a hot A-type star) painted several hundred red dwarfs blue-white.
    it('falls back to the spectral type rather than to zero', () => {
      const fromNull = colorIndexToRgb(null, 'M4');
      const asIfZero = colorIndexToRgb(0);

      expect(fromNull.r).toBeGreaterThan(fromNull.b);
      expect(asIfZero.b).toBeGreaterThan(asIfZero.r);
    });

    it('matches the colour the same spectral type would give explicitly', () => {
      // K5 sits halfway between the K anchor (0.81) and the M anchor (1.40).
      const derived = colorIndexToRgb(null, 'K5');
      const explicit = colorIndexToRgb(1.105);

      expect(derived.r).toBeCloseTo(explicit.r, 6);
      expect(derived.g).toBeCloseTo(explicit.g, 6);
      expect(derived.b).toBeCloseTo(explicit.b, 6);
    });

    it('handles the bare lowercase classes HYG ships', () => {
      const color = colorIndexToRgb(null, 'm');
      expect(color.r).toBeGreaterThan(color.b);
    });

    it('falls back to neutral when the star is unclassified too', () => {
      const color = colorIndexToRgb(null, 'Unknown');
      expect(color.r).toBeCloseTo(1, 6);
      expect(color.g).toBeCloseTo(1, 6);
      expect(color.b).toBeCloseTo(1, 6);
    });

    it('is neutral when no spectral type is passed at all', () => {
      const color = colorIndexToRgb(null);
      expect(color.r).toBeCloseTo(color.b, 6);
    });
  });

  it('prefers a measured index over the spectral type', () => {
    // A measured index always wins, even if it disagrees with the classification.
    const measured = colorIndexToRgb(-0.3, 'M5');
    expect(measured.b).toBeGreaterThan(measured.r);
  });
});

describe('StarFieldRenderer', () => {
  const stars = [star({ id: 10, name: 'A' }), star({ id: 20, name: 'B', colorIndex: null, spectralType: 'M4' })];
  const positions = new Float32Array([0, 0, 0, 1, 2, 3]);

  it('builds one vertex per star with position, colour and size attributes', () => {
    const renderer = new StarFieldRenderer(stars, positions);
    const geometry = renderer.object.geometry;

    expect(geometry.getAttribute('position').count).toBe(2);
    expect(geometry.getAttribute('starColor').count).toBe(2);
    expect(geometry.getAttribute('starSize').count).toBe(2);
    renderer.dispose();
  });

  it('maps a vertex index back to its HYG star id', () => {
    const renderer = new StarFieldRenderer(stars, positions);

    expect(renderer.starIdAt(0)).toBe(10);
    expect(renderer.starIdAt(1)).toBe(20);
    renderer.dispose();
  });

  it('returns undefined for an out-of-range index', () => {
    const renderer = new StarFieldRenderer(stars, positions);

    expect(renderer.starIdAt(99)).toBeUndefined();
    expect(renderer.starIdAt(-1)).toBeUndefined();
    renderer.dispose();
  });

  it('colours an unphotometered star from its spectral type', () => {
    const renderer = new StarFieldRenderer(stars, positions);
    const colors = renderer.object.geometry.getAttribute('starColor');

    // Star B is an M4 with no measured index — it must come out red, not blue-white.
    expect(colors.getX(1)).toBeGreaterThan(colors.getZ(1));
    renderer.dispose();
  });

  it('renders brighter stars as larger points', () => {
    const renderer = new StarFieldRenderer([star({ id: 1, magnitude: -1 }), star({ id: 2, magnitude: 12 })], new Float32Array(6));
    const sizes = renderer.object.geometry.getAttribute('starSize');

    expect(sizes.getX(0)).toBeGreaterThan(sizes.getX(1));
    renderer.dispose();
  });

  it('handles an empty star field', () => {
    const renderer = new StarFieldRenderer([], new Float32Array(0));

    expect(renderer.object.geometry.getAttribute('position').count).toBe(0);
    expect(renderer.starIdAt(0)).toBeUndefined();
    renderer.dispose();
  });
});
