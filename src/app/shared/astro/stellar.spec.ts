import { describe, expect, it } from 'vitest';

import {
  absoluteMagnitude,
  blackbodyColor,
  bolometricCorrection,
  effectiveTemperatureK,
  luminositySolar,
  radiusFromLuminositySolar,
  SOLAR_ABSOLUTE_MAGNITUDE_V,
  SOLAR_BOLOMETRIC_MAGNITUDE,
  SOLAR_EFFECTIVE_TEMPERATURE_K
} from './stellar';

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

  it('reads the correction off the colour where the catalogue has no type', () => {
    // Barnard's Star, 0.0035 L☉ (Dawson & De Robertis 2004), as a star no one classified: the
    // Sun's correction left it at an eighth of that.
    const derived = luminositySolar({ magnitude: 9.54, distancePc: 1.8266, spectralType: 'Unknown', magnitudeBand: 'V', colorIndex: 1.57, colorSystem: 'B-V' })!;
    expect(derived / 0.0035).toBeGreaterThan(1 / 1.5);
    expect(derived / 0.0035).toBeLessThan(1.5);
  });

  it('carries a Gaia G magnitude to V before correcting it', () => {
    // TRAPPIST-1 as Gaia has it, 5.53e-4 L☉ (Agol et al. 2021). Read as V its G is 3.1
    // magnitudes too bright, and its luminosity comes out seventeen times too high.
    const derived = luminositySolar({ magnitude: 15.6226, distancePc: 12.467, spectralType: 'Unknown', magnitudeBand: 'G', colorIndex: 4.902, colorSystem: 'BP-RP' })!;
    expect(derived / 5.53e-4).toBeGreaterThan(1 / 1.5);
    expect(derived / 5.53e-4).toBeLessThan(1.5);
  });

  it("reads a giant's temperature and correction both off its type, not the cooler dwarf's its colour reads as", () => {
    // Antares, M1 Ib at B−V 1.87: 3 660 K (Ohnaka et al. 2013), where its colour's dwarf is 3 019.
    const antares = { magnitude: 1.06, distancePc: 169.78, spectralType: 'M1Ib + B2.5V', magnitudeBand: 'V', colorIndex: 1.865, colorSystem: 'B-V' } as const;
    expect(Math.abs(effectiveTemperatureK(antares)! - 3660)).toBeLessThan(100);
    // Each piece of van Belle et al.'s (2021) table 8, at G0 = 50, K0 = 60, M0 = 66 on its index:
    // G8 III 7856 − 52.74 × 58, K2 III 16751 − 199.41 × 62, and flat at 3 134 K from M6 III.
    const giant = (spectralType: string) => effectiveTemperatureK({ magnitude: 5, distancePc: 100, spectralType, colorIndex: null });
    expect(giant('G8III')).toBeCloseTo(4797.08, 1);
    expect(giant('K2III')).toBeCloseTo(4387.58, 1);
    expect(giant('M5.5III')).toBeCloseTo(3343.43, 1);
    expect(giant('M6III')).toBe(3134);
    expect(giant('M7III')).toBe(3134);
    // Aldebaran, K5 III, 44.2 R☉ (Richichi & Roccatagliata 2005), to a tenth; Rigel, B8 Ia, 74.1
    // (Baines et al. 2018), to a fifth. With a correction off the type beside the colour's
    // temperature, Rigel came out 101.6; with K5's own correction at 3 902 K, Aldebaran 52.
    const aldebaran = { magnitude: 0.87, distancePc: 20.433, spectralType: 'K5III', magnitudeBand: 'V', colorIndex: 1.538, colorSystem: 'B-V' } as const;
    const rigel = { magnitude: 0.18, distancePc: 264.55, spectralType: 'B8Ia', magnitudeBand: 'V', colorIndex: -0.03, colorSystem: 'B-V' } as const;
    for (const [star, published, tolerance] of [[aldebaran, 44.2, 1.1], [rigel, 74.1, 1.2]] as const) {
      const radius = radiusFromLuminositySolar(luminositySolar(star)!, effectiveTemperatureK(star)!);
      expect(radius / published).toBeGreaterThan(1 / tolerance);
      expect(radius / published).toBeLessThan(tolerance);
    }
  });

  it('reads a hot giant reddened by dust at its type, not at the cool star its colour reads as', () => {
    // Menkib, O7.5 Iab at B−V 0.02: 14 R☉ (Krtička & Kubát 2010). At its colour's 9 517 K and its
    // type's correction it was drawn at 95; the dust it is behind still leaves it dimmer than it is.
    const menkib = { magnitude: 3.98, distancePc: 408.881, spectralType: 'O7.5Iab:', magnitudeBand: 'V', colorIndex: 0.016, colorSystem: 'B-V' } as const;
    expect(effectiveTemperatureK(menkib)).toBeCloseTo(36100, 6);
    const radius = radiusFromLuminositySolar(luminositySolar(menkib)!, effectiveTemperatureK(menkib)!);
    expect(radius / 14).toBeGreaterThan(1 / 2.5);
    expect(radius / 14).toBeLessThan(2.5);
  });

  it("gives a carbon star the carbon stars' correction and temperature, not the Sun's correction at an M dwarf's", () => {
    // La Superba, C7 Iab: Bergeat et al. (2001) have it at bolometric magnitude 2.43, which at the
    // catalogue's 310 pc is 8 090 L☉. The Sun's −0.06 at 2 420 K gave 544 L☉ and 133 R☉.
    const laSuperba = { magnitude: 5.42, distancePc: 310.342, spectralType: 'C7Iab', magnitudeBand: 'V', colorIndex: 2.994, colorSystem: 'B-V' } as const;
    expect(luminositySolar(laSuperba)! / 8090).toBeGreaterThan(1 / 1.2);
    expect(luminositySolar(laSuperba)! / 8090).toBeLessThan(1.2);
    expect(effectiveTemperatureK(laSuperba)).toBe(2990);
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

describe('effectiveTemperatureK', () => {
  it("is the Sun's own for the Sun", () => {
    expect(effectiveTemperatureK({ magnitude: -26.7, distancePc: 0, colorIndex: 0.7 })).toBe(SOLAR_EFFECTIVE_TEMPERATURE_K);
  });

  it('reads a colour in its own system, and a spectral type where there is no colour', () => {
    // An M5 dwarf is 3 060 K at B−V 1.83 or BP−RP 3.35, and at its type alone.
    expect(effectiveTemperatureK({ magnitude: 11, distancePc: 5, colorIndex: 3.35, colorSystem: 'BP-RP' })).toBeCloseTo(3060, 0);
    expect(effectiveTemperatureK({ magnitude: 11, distancePc: 5, colorIndex: 1.83, colorSystem: 'B-V' })).toBeCloseTo(3060, 0);
    expect(effectiveTemperatureK({ magnitude: 11, distancePc: 5, spectralType: 'M5Ve', colorIndex: null })).toBeCloseTo(3060, 0);
    expect(effectiveTemperatureK({ magnitude: 11, distancePc: 5, spectralType: 'Unknown', colorIndex: null })).toBeNull();
  });

  it('reads a colour past the table at its end where there is no type, and the type where there is', () => {
    // An ultracool dwarf redder than M8.5, a white dwarf bluer than B9 at the 19 012 K Gentile
    // Fusillo et al. (2021) measure at its colour, not B9's 10 700, and an O star at its type's
    // 35 100 K, where B−V puts every O star at B0's 31 400.
    expect(effectiveTemperatureK({ magnitude: 14.005, distancePc: 4.005, spectralType: 'Unknown', magnitudeBand: 'G', colorIndex: 5.113, colorSystem: 'BP-RP' })).toBe(2420);
    expect(effectiveTemperatureK({ magnitude: 14, distancePc: 25, spectralType: 'Unknown', magnitudeBand: 'G', colorIndex: -0.25, colorSystem: 'BP-RP' })).toBeCloseTo(19012, 6);
    expect(effectiveTemperatureK({ magnitude: 7, distancePc: 121, spectralType: 'O8', colorIndex: -0.31, colorSystem: 'B-V' })).toBe(35100);
    // HD 49748, G5 V at B−V −0.32: the colour is the one that is wrong.
    const g5 = effectiveTemperatureK({ magnitude: 9, distancePc: 184, spectralType: 'G5V', colorIndex: null })!;
    expect(effectiveTemperatureK({ magnitude: 9, distancePc: 184, spectralType: 'G5V', colorIndex: -0.319, colorSystem: 'B-V' })).toBe(g5);
    expect(g5).toBeGreaterThan(5500);
  });
});

describe('a dwarf with a type and no colour', () => {
  it("is drawn at its type's row of the dwarf sequence, not at the textbook colour of its type", () => {
    // GJ 3655, M8 at V 19.57 and 14.35 pc: M8 V is 2 570 K and 0.114 R☉ (Mamajek's table, 2022.04.16).
    // Through the textbook colour, B−V 1.88, the table's M5, and the textbook correction, −3.92
    // where M8's is −5.65, it was 3 001 K and 0.035 R☉, a third of Jupiter.
    const gj3655 = { magnitude: 19.57, distancePc: 14.35, spectralType: 'M8', magnitudeBand: 'V', colorIndex: null } as const;
    expect(effectiveTemperatureK(gj3655)).toBeCloseTo(2570, 6);
    const radius = radiusFromLuminositySolar(luminositySolar(gj3655)!, effectiveTemperatureK(gj3655)!);
    expect(radius / 0.114).toBeGreaterThan(1 / 1.2);
    expect(radius / 0.114).toBeLessThan(1.2);
  });
});

describe('radiusFromLuminositySolar', () => {
  it('is one for the Sun', () => {
    expect(radiusFromLuminositySolar(1, SOLAR_EFFECTIVE_TEMPERATURE_K)).toBeCloseTo(1, 12);
  });

  it("gives an ultracool dwarf redder than the table an M8.5 dwarf's radius, not none", () => {
    // Gaia DR3 6439125097427143808, 4.0 pc away at BP−RP 5.11; M8.5 V is 0.104 R☉ (Mamajek).
    const star = { magnitude: 14.005, distancePc: 4.005, spectralType: 'Unknown', magnitudeBand: 'G', colorIndex: 5.113, colorSystem: 'BP-RP' } as const;
    const radius = radiusFromLuminositySolar(luminositySolar(star)!, effectiveTemperatureK(star)!);
    expect(radius / 0.104).toBeGreaterThan(1 / 1.2);
    expect(radius / 0.104).toBeLessThan(1.2);
  });

  it('gives a white dwarf bluer than the table the radius its mass and gravity give', () => {
    // Gaia DR3 6791196382856581376, 24.5 pc: 19 205 K, log g 8.07 and 0.66 M☉ in Gentile Fusillo et
    // al. (2021), so 0.01245 R☉. At B9's 10 700 K it came out about 1.5 times that.
    const star = { magnitude: 12.9198, distancePc: 24.5237, spectralType: 'Unknown', magnitudeBand: 'G', colorIndex: -0.2539, colorSystem: 'BP-RP' } as const;
    const radius = radiusFromLuminositySolar(luminositySolar(star)!, effectiveTemperatureK(star)!);
    expect(radius / 0.01245).toBeGreaterThan(1 / 1.2);
    expect(radius / 0.01245).toBeLessThan(1.2);
  });

  it('gives Sirius and TRAPPIST-1 their published radii from colour and brightness alone', () => {
    // 1.711 R☉ (Liebert et al. 2005) and 0.119 R☉ (Agol et al. 2021), each to within a fifth.
    for (const [star, published] of [
      [{ magnitude: -1.44, distancePc: 2.6371, magnitudeBand: 'V', colorIndex: 0.009, colorSystem: 'B-V' }, 1.711],
      [{ magnitude: 15.6226, distancePc: 12.467, magnitudeBand: 'G', colorIndex: 4.902, colorSystem: 'BP-RP' }, 0.119]
    ] as const) {
      const radius = radiusFromLuminositySolar(luminositySolar(star)!, effectiveTemperatureK(star)!);
      expect(radius / published).toBeGreaterThan(0.8);
      expect(radius / published).toBeLessThan(1.2);
    }
  });
});

describe('blackbodyColor', () => {
  /** As the display shows it: sRGB-encoded, 0 to 255. */
  const displayed = (rgb: readonly number[]) => rgb.map((v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));

  it('gives the colours of the stars against the display white', () => {
    // Charity's blackbody colour table (CIE 1931 2°, D65): 2 900 K #ffb662, 5 800 K #fff1e7, 9 600 K #d3ddff.
    for (const [temperatureK, expected] of [[2900, [255, 182, 98]], [5800, [255, 241, 231]], [9600, [211, 221, 255]]] as const) {
      displayed(blackbodyColor(temperatureK)).forEach((channel, i) => expect(Math.abs(channel - expected[i])).toBeLessThanOrEqual(5));
    }
  });

  it("is white at the white point it is given, and an M dwarf's light orange-red against the Sun's", () => {
    expect(blackbodyColor(SOLAR_EFFECTIVE_TEMPERATURE_K, SOLAR_EFFECTIVE_TEMPERATURE_K)).toEqual([1, 1, 1]);
    const [r, g, b] = blackbodyColor(2566, SOLAR_EFFECTIVE_TEMPERATURE_K);
    expect(r).toBe(1);
    expect(g).toBeCloseTo(0.44, 2);
    expect(b).toBeCloseTo(0.1, 2);
  });

  it('holds the ends of the fit, and never goes negative', () => {
    expect(blackbodyColor(800)).toEqual(blackbodyColor(1667));
    expect(blackbodyColor(60000)).toEqual(blackbodyColor(25000));
    expect(Math.min(...blackbodyColor(1667))).toBe(0);
  });
});
