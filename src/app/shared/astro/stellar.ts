import { DwarfSequencePoint, dwarfSequenceAtColor, dwarfSequenceAtTemperature, dwarfSequenceAtType, isGiant, parseSpectralClass, SpectralClass } from './spectral';

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
  /** Apparent magnitude, as catalogued, in `magnitudeBand`. */
  magnitude: number;
  /** Distance from the Sun in parsecs; `0` identifies the Sun itself. */
  distancePc: number;
  spectralType?: string;
  /** V, or Gaia's G — which for an M5 dwarf reads 1.7 magnitudes brighter. Taken as V if absent. */
  magnitudeBand?: 'V' | 'G';
  colorIndex?: number | null;
  colorSystem?: 'B-V' | 'BP-RP';
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

  // Where the star has a colour the dwarf sequence covers, its correction is read off that colour,
  // and a G magnitude is carried to V first; otherwise both are read off the same table at its
  // spectral type, and only with neither is a G magnitude taken as V. Gaia classifies none of its
  // stars, so every one of them used to be given the Sun's correction, and TRAPPIST-1 came out at
  // a seventh of its luminosity. Against the archive's own figure for 1 449 hosts, the worst tenth
  // was off by 0.29 dex or more, and is now off by 0.12. A type with no colour took the textbook
  // anchors below instead, M8 −3.92 where the table has −5.65: GJ 3655, M8, came out 8.9×10⁻⁵ L☉
  // at 3 001 K and 0.035 R☉, where its type's row gives 2 570 K and 0.106.
  //
  // Not for a star its type says is a giant, though, whose correction is read off its type along
  // with its temperature: see giantSurface.
  const sequence = sequenceAtColour(star) ?? dwarfSequenceAtType(star.spectralType);
  const absoluteV = absolute - (star.magnitudeBand === 'G' ? (sequence?.gMinusV ?? 0) : 0);
  const correction = giantSurface(star.spectralType)?.bolometricCorrectionV ?? sequence?.bolometricCorrectionV ?? bolometricCorrection(star.spectralType);
  const bolometric = absoluteV + correction;
  const luminosity = Math.pow(10, (SOLAR_BOLOMETRIC_MAGNITUDE - bolometric) / 2.5);
  return Math.min(Math.max(luminosity, MIN_LUMINOSITY_SOLAR), MAX_LUMINOSITY_SOLAR);
}

/**
 * The dwarf sequence at a star's colour — past the table's end, where the star has no type to go
 * by instead, at the end a colour is past. Past the red end are the ultracool dwarfs Gaia measures
 * redder than BP−RP 5.1, M8.5, and past B−V's blue end its O stars; Gaia's white dwarfs, bluer
 * than BP−RP −0.12, are read at the temperature white dwarfs of their colour are measured at.
 * Unread, they had no temperature and were drawn at the Sun's: Gaia DR3 6439125097427143808, an
 * ultracool dwarf 4.0 pc away, and 110 white dwarfs within 50 pc, all at 1 R☉. Beside a type, an
 * off-table colour is more often a bad one than an extreme star — HD 49748, G5 V, at B−V −0.32 —
 * and the type is read instead.
 */
function sequenceAtColour(star: Pick<StellarPhotometry, 'spectralType' | 'colorIndex' | 'colorSystem'>): DwarfSequencePoint | null {
  if (star.colorIndex == null) {
    return null;
  }
  return dwarfSequenceAtColor(star.colorIndex, star.colorSystem) ?? (parseSpectralClass(star.spectralType) ? null : dwarfSequenceAtColor(star.colorIndex, star.colorSystem, true));
}

/** The Sun's effective temperature, the IAU 2015 nominal value. */
export const SOLAR_EFFECTIVE_TEMPERATURE_K = 5772;

/**
 * Effective temperature, off the dwarf sequence at the star's colour, or at its spectral type where
 * it has none; a giant's off its type (giantSurface). Exactly the Sun's for the Sun, which is at
 * zero distance here. The type was read through the textbook colour `spectralTypeToColorIndex`
 * gives it, which the table puts elsewhere: M8's 1.88 is M5's, 3 001 K where M8 is 2 570, and every
 * O type came out B0's 31 400.
 */
export function effectiveTemperatureK(star: StellarPhotometry): number | null {
  if (star.distancePc === 0) {
    return SOLAR_EFFECTIVE_TEMPERATURE_K;
  }
  return giantSurface(star.spectralType)?.temperatureK ?? (sequenceAtColour(star) ?? dwarfSequenceAtType(star.spectralType))?.temperatureK ?? null;
}

/**
 * Whether {@link effectiveTemperatureK} reads the star off its colour rather than off its type: not
 * for a giant, nor for a star with no colour the table reads, which since 206e88a is 821 dwarfs
 * placed at their type's row. The card said their radii came "from colour and brightness".
 */
export function temperatureFromColour(star: Pick<StellarPhotometry, 'spectralType' | 'colorIndex' | 'colorSystem'>): boolean {
  return giantSurface(star.spectralType) === null && sequenceAtColour(star) !== null;
}

/**
 * What a giant's type says of its surface: its effective temperature, and the bolometric
 * correction the dwarf sequence has at that temperature — both off the type, so that the two a
 * radius is drawn from come from the same place. `null` for a star that is not a giant, or whose
 * class the parser cannot read.
 *
 * Read off the colour, a giant is the dwarf of its colour, too cool: Antares, M1 Ib at B−V 1.87,
 * came out 3 019 K against the 3 660 Ohnaka et al. (2013) measure, and the 610 M giants a median
 * 3 275 K where M2 III is about 3 650. Worse, a hot giant behind dust reads as a far cooler star:
 * Menkib, O7.5 Iab at B−V 0.02, was 9 517 K, and with its type's correction beside that colour's
 * temperature it was drawn at 95 R☉, and Alp Cam, O9.5 Ia, at 338, where 14 and 21 are published.
 *
 * G to M giants take van Belle et al.'s (2021, ApJ 922, 163, table 8) interferometric scale, fitted
 * to 191 giants from G1 to M7.75 III: 4 797 K at G8, 4 388 at K2, 3 816 at M0, 3 472 at M4, and held
 * at 3 134 K from M6, where its own M6 and M7 giants average 3 112 and 3 114 K. Carried on to M7.9
 * instead, the M6 giants were 3 300 K and drawn 30 % too small. O to F giants take the dwarf of their type, which a supergiant of the same type is within
 * a few per cent of from B8 on, and a few thousand kelvin cooler than at B0 (Alnilam, B0 Ia, about
 * 27 000 K against B0 V's 31 400). Carbon and S stars take {@link CARBON_STAR}.
 */
export function giantSurface(spectralType: string | null | undefined): GiantSurface | null {
  // ponytail: kept per type string, unbounded; the catalogue has 2 888 of them. The star field asks
  // for each of its 455 571 stars at boot, and the split and two regular expressions took 20-40 ms.
  if (!GIANT_SURFACES.has(spectralType)) {
    GIANT_SURFACES.set(spectralType, giantSurfaceOfType(spectralType));
  }
  return GIANT_SURFACES.get(spectralType)!;
}

type GiantSurface = { temperatureK: number; bolometricCorrectionV: number };
const GIANT_SURFACES = new Map<string | null | undefined, GiantSurface | null>();

function giantSurfaceOfType(spectralType: string | null | undefined): GiantSurface | null {
  if (!isGiant(spectralType)) {
    return null;
  }
  const primary = (spectralType ?? '').split('+')[0].trim();
  if (/^[CNRS]/.test(primary)) {
    return CARBON_STAR;
  }
  const parsed = parseSpectralClass(primary);
  if (!parsed) {
    return null;
  }
  const { spectralClass, subclass } = parsed;
  if (spectralClass === 'G' || spectralClass === 'K' || spectralClass === 'M') {
    // van Belle's index: G0 at 50, K0 at 60, K5 at 65 and M0 at 66, so a K later than K5 falls between.
    const index = spectralClass === 'G' ? 50 + subclass : spectralClass === 'K' ? 60 + Math.min(subclass, 5) + Math.max(subclass - 5, 0) / 5 : 66 + subclass;
    const temperatureK = index <= 61 ? 7856 - 52.74 * index : index <= 64 ? 16751 - 199.41 * index : index < 72 ? 9491 - 85.98 * index : 3134;
    return { temperatureK, bolometricCorrectionV: dwarfSequenceAtTemperature(temperatureK).bolometricCorrectionV };
  }
  const dwarf = dwarfSequenceAtType(primary)!;
  return { temperatureK: dwarf.temperatureK, bolometricCorrectionV: dwarf.bolometricCorrectionV };
}

/**
 * A carbon or S star's temperature and bolometric correction to V: the medians of Bergeat, Knapik &
 * Rutily (2001, A&A 369, 178) over the 441 carbon stars of their table 10, and over the 383 of
 * those with a V magnitude. No type in the table reads for them, and they were given the Sun's
 * −0.06 at the M8.5 dwarf's 2 420 K: La Superba came out 544 L☉ and 133 R☉, where Bergeat's own
 * figures give 8 090 L☉ at the same distance and McDonald et al. (2017) 315 R☉. S stars, between M
 * and C, are given the carbon stars' figures for want of their own.
 */
const CARBON_STAR = { temperatureK: 2990, bolometricCorrectionV: -2.83 } as const;

/**
 * Radius in solar radii from luminosity and temperature — Stefan-Boltzmann, L = 4πR²σT⁴, in solar
 * units. Luminosity-class blind, since the luminosity comes from the distance: a giant comes out a
 * giant whatever the sequence took it for.
 */
export function radiusFromLuminositySolar(luminositySolar: number, temperatureK: number): number {
  return Math.sqrt(luminositySolar) / (temperatureK / SOLAR_EFFECTIVE_TEMPERATURE_K) ** 2;
}

/** The range Kim et al.'s fit to the Planckian locus covers; a temperature outside it is clamped. */
const PLANCKIAN_LOCUS_MIN_K = 1667;
const PLANCKIAN_LOCUS_MAX_K = 25000;

/**
 * The colour of a blackbody at `temperatureK`, in linear sRGB with its brightest channel at 1:
 * its chromaticity off the Planckian locus (Kim et al. 2002, the cubic fit to CIE 1931), then
 * CIE XYZ to sRGB. Against the display's own white, D65, unless `whitePointK` names the blackbody
 * that is to read as white — as the Sun's does for the photographs of its planets, which were
 * taken in its light.
 *
 * At D65, a 2 900 K M dwarf is sRGB (255, 180, 103), the Sun (255, 241, 234), a 9 600 K A star
 * (208, 219, 255): Charity's table, which integrates the Planck spectrum, gives (255, 182, 98),
 * (255, 241, 231) at 5 800 K and (211, 221, 255).
 */
export function blackbodyColor(temperatureK: number, whitePointK?: number): [number, number, number] {
  const rgb = blackbodyLinearSrgb(temperatureK);
  const white = whitePointK === undefined ? [1, 1, 1] : blackbodyLinearSrgb(whitePointK);
  const relative = rgb.map((channel, i) => channel / white[i]);
  const brightest = Math.max(...relative);
  return relative.map((channel) => channel / brightest) as [number, number, number];
}

function blackbodyLinearSrgb(temperatureK: number): number[] {
  const t = 1000 / Math.min(Math.max(temperatureK, PLANCKIAN_LOCUS_MIN_K), PLANCKIAN_LOCUS_MAX_K);
  const x =
    t >= 0.25 ? -0.2661239 * t ** 3 - 0.2343589 * t ** 2 + 0.8776956 * t + 0.17991 : -3.0258469 * t ** 3 + 2.1070379 * t ** 2 + 0.2226347 * t + 0.24039;
  const y =
    t >= 1000 / 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : t >= 0.25
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const [X, Y, Z] = [x / y, 1, (1 - x - y) / y];
  // Below 1 920 K the locus leaves the sRGB gamut, and blue comes out negative.
  return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z].map((channel) => Math.max(channel, 0));
}
