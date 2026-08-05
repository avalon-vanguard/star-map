import { parseSpectralClass, SpectralClass } from './spectral';

/**
 * Stellar luminosity, derived from the two things the star catalogue actually measures.
 *
 * Nothing here is a published luminosity: HYG carries apparent magnitude and a parallax, and
 * the Exoplanet Archive columns that would give a host star's mass or effective temperature are
 * not in the shipped dataset. What those two measurements do give, exactly, is absolute
 * magnitude — and from there the bolometric correction below turns a V-band brightness into a
 * total energy output, which is what a planet's temperature actually depends on.
 */

/** The Sun's absolute magnitude in V — what the distance modulus below is measured against. */
export const SOLAR_ABSOLUTE_MAGNITUDE_V = 4.83;

/**
 * The Sun's absolute *bolometric* magnitude, the IAU 2015 zero point. Distinct from the V-band
 * figure above by the Sun's own bolometric correction, and it is the one the ratio is taken
 * against — mixing the two would leave every luminosity 9% high.
 */
export const SOLAR_BOLOMETRIC_MAGNITUDE = 4.74;

/**
 * Bolometric corrections for main-sequence stars, at subclass 0 of each class (Pecaut & Mamajek
 * 2013, rounded). Always negative: a star radiates outside the V band as well as in it, so its
 * total output always exceeds what a visual magnitude alone implies.
 *
 * The correction matters most exactly where it is largest. An M dwarf emits the bulk of its
 * light in the infrared, so taking its V magnitude at face value understates it by more than a
 * factor of ten — and M dwarfs are what most of the nearby planet hosts are.
 */
const BOLOMETRIC_CORRECTION_ANCHORS: Readonly<Record<SpectralClass, number>> = {
  O: -4.0,
  B: -3.0,
  A: -0.25,
  F: -0.01,
  G: -0.06,
  K: -0.24,
  M: -1.21
};

/** Correction at the cool end of class M, so the latest subclasses interpolate toward it. */
const BEYOND_M_CORRECTION = -4.6;

/**
 * Range the derived luminosity is clamped to, in solar luminosities.
 *
 * A guard against the one systematic error this method cannot detect on its own: the
 * corrections above assume a main-sequence star, and HYG often records a spectral class with no
 * luminosity class at all. A red giant read as a K dwarf comes out hundreds of times too
 * bright, which is a large error but not an unbounded one — these bounds simply keep a
 * pathological record from producing a temperature of a million kelvin.
 */
const MIN_LUMINOSITY_SOLAR = 1e-6;
const MAX_LUMINOSITY_SOLAR = 1e7;

/**
 * Absolute magnitude from apparent magnitude and distance — the distance modulus.
 *
 * Returns `null` for a star at zero distance, which in this catalogue means the Sun: its
 * apparent magnitude of -26.7 is a statement about how close it is, not about how bright it is,
 * and the formula has no answer there.
 */
export function absoluteMagnitude(apparentMagnitude: number, distancePc: number): number | null {
  if (!Number.isFinite(apparentMagnitude) || !Number.isFinite(distancePc) || distancePc <= 0) {
    return null;
  }
  return apparentMagnitude - 5 * Math.log10(distancePc) + 5;
}

/**
 * Bolometric correction for a spectral type, interpolated between the class anchors. Falls back
 * to the solar value when the catalogue records no usable classification, which biases a
 * misclassified red dwarf dim rather than inventing a correction for it.
 */
export function bolometricCorrection(spectralType: string | null | undefined): number {
  const parsed = parseSpectralClass(spectralType);
  if (!parsed) {
    return BOLOMETRIC_CORRECTION_ANCHORS.G;
  }

  const { spectralClass, subclass } = parsed;
  const classes = Object.keys(BOLOMETRIC_CORRECTION_ANCHORS) as SpectralClass[];
  const index = classes.indexOf(spectralClass);
  const from = BOLOMETRIC_CORRECTION_ANCHORS[spectralClass];
  const to = index < classes.length - 1 ? BOLOMETRIC_CORRECTION_ANCHORS[classes[index + 1]] : BEYOND_M_CORRECTION;
  const t = Math.min(Math.max(subclass, 0), 10) / 10;

  return from + (to - from) * t;
}

/** Everything about a star that bears on how much light it puts out. */
export interface StellarPhotometry {
  /** Apparent visual magnitude, as catalogued. */
  magnitude: number;
  /** Distance from the Sun in parsecs; `0` identifies the Sun itself. */
  distancePc: number;
  spectralType?: string;
}

/**
 * Total luminosity in solar units.
 *
 * The Sun is returned as exactly 1 rather than derived — it is the definition of the unit, and
 * it is the one star whose distance in this catalogue is zero.
 *
 * Accurate to roughly a factor of two for main-sequence stars, which is better than it sounds
 * for what it is used for: a planet's equilibrium temperature goes as the fourth root of this,
 * so even a factor of two moves a temperature by less than a fifth.
 */
export function luminositySolar(star: StellarPhotometry): number | null {
  if (star.distancePc === 0) {
    return 1;
  }

  const absolute = absoluteMagnitude(star.magnitude, star.distancePc);
  if (absolute === null) {
    return null;
  }

  const bolometric = absolute + bolometricCorrection(star.spectralType);
  const luminosity = Math.pow(10, (SOLAR_BOLOMETRIC_MAGNITUDE - bolometric) / 2.5);
  return Math.min(Math.max(luminosity, MIN_LUMINOSITY_SOLAR), MAX_LUMINOSITY_SOLAR);
}
