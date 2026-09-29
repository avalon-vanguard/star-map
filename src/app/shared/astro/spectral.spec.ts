import { describe, expect, it } from 'vitest';

import { dwarfSequenceAtColor, isGiant, parseSpectralClass, SPECTRAL_CLASSES, spectralTypeFromColor, spectralTypeToColorIndex, temperatureToColorIndex } from './spectral';

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

describe('isGiant', () => {
  it('reads luminosity classes I to III off the primary, the giant and supergiant prefixes, and carbon and S stars', () => {
    for (const type of ['M1Ib + B2.5V', 'K5III', 'M2II-IIIvar', 'C7Iab', 'K0IIIb', 'gK0', 'cM2', 'N5', 'Ce+', 'S57:']) {
      expect(isGiant(type), type).toBe(true);
    }
  });

  it('leaves dwarfs, subgiants, a dwarf with a giant companion and the unclassified alone', () => {
    for (const type of ['G2V', 'B2IV', 'F0IVn', 'M5Ve', 'K1V + M3III', 'g-k', 'Unknown', 'DA', '']) {
      expect(isGiant(type), type).toBe(false);
    }
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

describe('temperatureToColorIndex', () => {
  it("puts the Sun's temperature at its own B-V and a cool dwarf redder", () => {
    expect(temperatureToColorIndex(5772)).toBeCloseTo(0.65, 2);
    expect(temperatureToColorIndex(3400)).toBeCloseTo(1.79, 2);
  });

  it('stays inside the range the spectral classes span', () => {
    expect(temperatureToColorIndex(2566)).toBe(2);
    expect(temperatureToColorIndex(50000)).toBe(-0.33);
  });

  it('has no answer for a temperature that is not one', () => {
    expect(temperatureToColorIndex(0)).toBeNull();
    expect(temperatureToColorIndex(Number.NaN)).toBeNull();
  });
});

describe('spectralTypeFromColor', () => {
  it("reads the Sun's type off either colour", () => {
    expect(spectralTypeFromColor(0.65, 'B-V')).toBe('G2');
    expect(spectralTypeFromColor(0.82, 'BP-RP')).toBe('G2');
  });

  it('reads a red dwarf the way it was classified', () => {
    // TRAPPIST-1 is M8 V, and Gaia has it at BP−RP 4.90; Proxima is M5.5 Ve at B−V 1.81.
    expect(spectralTypeFromColor(4.902, 'BP-RP')).toBe('M8');
    expect(spectralTypeFromColor(1.807, 'B-V')).toBe('M5');
  });

  it('does not read one colour as the other', () => {
    // 1.43 is a K5 dwarf in BP−RP and an M0 in B−V.
    expect(spectralTypeFromColor(1.43, 'BP-RP')).toBe('K5');
    expect(spectralTypeFromColor(1.43, 'B-V')).toBe('M0');
    expect(spectralTypeFromColor(1.43)).toBe('M0');
  });

  it('has no answer past either end of the table, nor without a colour', () => {
    expect(spectralTypeFromColor(-0.35, 'B-V')).toBeNull();
    expect(spectralTypeFromColor(-0.15, 'BP-RP')).toBeNull();
    expect(spectralTypeFromColor(5.5, 'BP-RP')).toBeNull();
    expect(spectralTypeFromColor(null, 'B-V')).toBeNull();
    expect(spectralTypeFromColor(-0.301, 'B-V')).toBe('B0');
  });
});

describe('dwarfSequenceAtColor', () => {
  it("puts the Sun's colour in either system at the Sun's temperature and correction", () => {
    for (const [colour, system] of [[0.65, 'B-V'], [0.823, 'BP-RP']] as const) {
      const point = dwarfSequenceAtColor(colour, system)!;
      expect(point.temperatureK).toBeCloseTo(5770, 0);
      expect(point.bolometricCorrectionV).toBeCloseTo(-0.085, 3);
      expect(point.gMinusV).toBeCloseTo(-0.165, 3);
    }
  });

  it('interpolates between the two types a colour falls between', () => {
    // Halfway from M1.5 (B−V 1.495, 3 620 K, −1.50) to M2 (1.505, 3 560 K, −1.62).
    const point = dwarfSequenceAtColor(1.5, 'B-V')!;
    expect(point.temperatureK).toBeCloseTo(3590, 6);
    expect(point.bolometricCorrectionV).toBeCloseTo(-1.56, 6);
  });

  it('has no answer past either end of the table, and no G−V where none is tabulated', () => {
    expect(dwarfSequenceAtColor(2.2, 'B-V')).toBeNull();
    expect(dwarfSequenceAtColor(-0.15, 'BP-RP')).toBeNull();
    expect(dwarfSequenceAtColor(null)).toBeNull();
    expect(dwarfSequenceAtColor(-0.29, 'B-V')!.gMinusV).toBeNull();
  });

  it('reads the row at the end a colour is past, when asked to', () => {
    expect(dwarfSequenceAtColor(2.2, 'B-V', true)).toEqual({ temperatureK: 2420, bolometricCorrectionV: -5.78, gMinusV: -3.09 });
    expect(dwarfSequenceAtColor(-0.15, 'BP-RP', true)).toEqual({ temperatureK: 10700, bolometricCorrectionV: -0.42, gMinusV: 0.018 });
    expect(dwarfSequenceAtColor(null, 'B-V', true)).toBeNull();
  });
});
