import { describe, expect, it } from 'vitest';

import { parseSpectralClass, SPECTRAL_CLASSES, spectralTypeToColorIndex } from './spectral';

describe('parseSpectralClass', () => {
  it('reads a clean class and subclass', () => {
    expect(parseSpectralClass('M3.5')).toEqual({ spectralClass: 'M', subclass: 3.5 });
    expect(parseSpectralClass('G2V')).toEqual({ spectralClass: 'G', subclass: 2 });
  });

  it('defaults the subclass to 0 when only a class is given', () => {
    expect(parseSpectralClass('K')).toEqual({ spectralClass: 'K', subclass: 0 });
  });

  it('accepts the lowercase forms HYG actually ships', () => {
    // 354 nearby stars are classified as a bare lowercase "m".
    expect(parseSpectralClass('m')).toEqual({ spectralClass: 'M', subclass: 0 });
    expect(parseSpectralClass('k')).toEqual({ spectralClass: 'K', subclass: 0 });
  });

  it('skips a luminosity prefix to find the class', () => {
    expect(parseSpectralClass('dM4')?.spectralClass).toBe('M');
    expect(parseSpectralClass('sdM')?.spectralClass).toBe('M');
    expect(parseSpectralClass('gK5')?.spectralClass).toBe('K');
  });

  it('takes the warmer end of a range', () => {
    expect(parseSpectralClass('k-m')?.spectralClass).toBe('K');
    expect(parseSpectralClass('g-k')?.spectralClass).toBe('G');
  });

  it('tolerates uncertainty flags and luminosity suffixes', () => {
    expect(parseSpectralClass('K:')).toEqual({ spectralClass: 'K', subclass: 0 });
    expect(parseSpectralClass('K5 V')).toEqual({ spectralClass: 'K', subclass: 5 });
    expect(parseSpectralClass('m+')).toEqual({ spectralClass: 'M', subclass: 0 });
  });

  it('returns null when there is no recognisable class', () => {
    for (const input of ['', '   ', '...', undefined, null]) {
      expect(parseSpectralClass(input)).toBeNull();
    }
  });

  it('ignores an out-of-range subclass rather than trusting it', () => {
    expect(parseSpectralClass('M42')).toEqual({ spectralClass: 'M', subclass: 0 });
  });
});

describe('spectralTypeToColorIndex', () => {
  it('places the Sun near its real B-V of 0.65', () => {
    expect(spectralTypeToColorIndex('G2V')).toBeCloseTo(0.626, 2);
  });

  it('makes hot classes blue (negative) and cool classes red (positive)', () => {
    expect(spectralTypeToColorIndex('O5')).toBeLessThan(0);
    expect(spectralTypeToColorIndex('B0')).toBeLessThan(0);
    expect(spectralTypeToColorIndex('M5')).toBeGreaterThan(1);
  });

  it('increases monotonically from hot to cool across the sequence', () => {
    const values = SPECTRAL_CLASSES.map((spectralClass) => spectralTypeToColorIndex(spectralClass)!);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it('interpolates between class anchors by subclass', () => {
    const g0 = spectralTypeToColorIndex('G0')!;
    const g5 = spectralTypeToColorIndex('G5')!;
    const k0 = spectralTypeToColorIndex('K0')!;

    expect(g5).toBeGreaterThan(g0);
    expect(g5).toBeLessThan(k0);
    expect(g5).toBeCloseTo((g0 + k0) / 2, 6);
  });

  it('keeps the coolest subclasses inside a sane range', () => {
    const m9 = spectralTypeToColorIndex('M9')!;
    expect(m9).toBeGreaterThan(spectralTypeToColorIndex('M0')!);
    expect(m9).toBeLessThanOrEqual(2);
  });

  it('returns null for an unclassified star', () => {
    expect(spectralTypeToColorIndex('Unknown')).toBeNull();
    expect(spectralTypeToColorIndex('')).toBeNull();
  });
});
