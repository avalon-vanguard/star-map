import { describe, expect, it } from 'vitest';

import { absoluteMagnitude, bolometricCorrection, luminositySolar, SOLAR_ABSOLUTE_MAGNITUDE_V, SOLAR_BOLOMETRIC_MAGNITUDE } from './stellar';

/** Real catalogue rows, with the published luminosity each one should reproduce. */
const SIRIUS = { magnitude: -1.44, distancePc: 2.6371, spectralType: 'A0m...', publishedLuminosity: 25.4 };
const VEGA = { magnitude: 0.03, distancePc: 7.68, spectralType: 'A0Vvar', publishedLuminosity: 40 };
const PROXIMA = { magnitude: 11.01, distancePc: 1.2959, spectralType: 'M5Ve', publishedLuminosity: 0.0015 };
const ALPHA_CEN_A = { magnitude: -0.01, distancePc: 1.3247, spectralType: 'G2V', publishedLuminosity: 1.52 };

describe('absoluteMagnitude', () => {
  it('is the apparent magnitude at the reference distance of ten parsecs', () => {
    expect(absoluteMagnitude(5, 10)).toBeCloseTo(5, 12);
  });

  it('brightens a star as it is placed further away for the same apparent magnitude', () => {
    expect(absoluteMagnitude(5, 100)).toBeLessThan(absoluteMagnitude(5, 10)!);
  });

  it('reproduces the published absolute magnitude of Sirius', () => {
    expect(absoluteMagnitude(SIRIUS.magnitude, SIRIUS.distancePc)).toBeCloseTo(1.45, 1);
  });

  it('has no answer at zero distance, which in this catalogue is the Sun', () => {
    expect(absoluteMagnitude(-26.7, 0)).toBeNull();
    expect(absoluteMagnitude(5, -3)).toBeNull();
    expect(absoluteMagnitude(Number.NaN, 10)).toBeNull();
  });
});

describe('bolometricCorrection', () => {
  it('is never positive: a star always radiates outside the V band as well as in it', () => {
    for (const type of ['O5V', 'B2V', 'A0V', 'F5V', 'G2V', 'K5V', 'M5V', 'M9V', 'Unknown', '']) {
      expect(bolometricCorrection(type)).toBeLessThanOrEqual(0);
    }
  });

  it('is small for the Sun and large for a red dwarf, which is the whole reason it is applied', () => {
    // An M dwarf emits most of its light in the infrared: taking its V magnitude at face value
    // understates it by more than a factor of ten.
    expect(Math.abs(bolometricCorrection('G2V'))).toBeLessThan(0.2);
    expect(bolometricCorrection('M5V')).toBeLessThan(-2);
  });

  it('reproduces the Sun own correction closely enough to close the loop on the zero point', () => {
    // The two solar magnitudes differ by exactly this correction, so a solar twin must come out
    // at one solar luminosity.
    expect(SOLAR_ABSOLUTE_MAGNITUDE_V + bolometricCorrection('G2V')).toBeCloseTo(SOLAR_BOLOMETRIC_MAGNITUDE, 1);
  });

  it('deepens monotonically from F through M, following the shift into the infrared', () => {
    const sequence = ['F0V', 'G0V', 'K0V', 'M0V', 'M5V'].map((type) => bolometricCorrection(type));
    for (let index = 1; index < sequence.length; index++) {
      expect(sequence[index]).toBeLessThan(sequence[index - 1]);
    }
  });

  it('falls back to a solar correction for an unclassified star rather than inventing one', () => {
    expect(bolometricCorrection('Unknown')).toBeCloseTo(bolometricCorrection('G0V'), 6);
    expect(bolometricCorrection(undefined)).toBeCloseTo(bolometricCorrection('G0V'), 6);
  });
});

describe('luminositySolar', () => {
  it('returns exactly one for the Sun, which defines the unit', () => {
    expect(luminositySolar({ magnitude: -26.7, distancePc: 0, spectralType: 'G2V' })).toBe(1);
  });

  it('lands within a factor of two of the published luminosity for real stars', () => {
    // The documented tolerance. It is looser than it sounds: equilibrium temperature goes as the
    // fourth root of this, so a factor of two is under a fifth in temperature.
    for (const star of [SIRIUS, VEGA, PROXIMA, ALPHA_CEN_A]) {
      const derived = luminositySolar(star)!;
      const ratio = derived / star.publishedLuminosity;
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2);
    }
  });

  it('gets a solar analogue essentially exactly right', () => {
    // Alpha Centauri A is the nearest star to a second Sun there is, so this is the case where
    // an error would be a mistake rather than a tolerance.
    expect(luminositySolar(ALPHA_CEN_A)!).toBeCloseTo(ALPHA_CEN_A.publishedLuminosity, 0);
  });

  it('orders stars the way their published luminosities do', () => {
    const derived = [PROXIMA, ALPHA_CEN_A, SIRIUS, VEGA].map((star) => luminositySolar(star)!);
    for (let index = 1; index < derived.length; index++) {
      expect(derived[index]).toBeGreaterThan(derived[index - 1]);
    }
  });

  it('applies the bolometric correction rather than taking V at face value', () => {
    // Without it a red dwarf comes out more than ten times too dim.
    const uncorrected = Math.pow(10, (SOLAR_BOLOMETRIC_MAGNITUDE - absoluteMagnitude(PROXIMA.magnitude, PROXIMA.distancePc)!) / 2.5);
    expect(luminositySolar(PROXIMA)!).toBeGreaterThan(uncorrected * 5);
  });

  it('clamps a pathological record instead of producing an absurd luminosity', () => {
    const absurd = luminositySolar({ magnitude: -40, distancePc: 5000, spectralType: 'O5V' })!;
    expect(Number.isFinite(absurd)).toBe(true);
    expect(absurd).toBeLessThanOrEqual(1e7);
  });

  it('has no answer for a star with no usable distance', () => {
    expect(luminositySolar({ magnitude: 5, distancePc: -1 })).toBeNull();
  });
});
