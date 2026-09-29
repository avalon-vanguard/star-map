/**
 * Spectral classification helpers.
 *
 * HYG leaves the B-V colour index blank for ~10% of nearby stars, but usually still records
 * *some* spectral classification. Since colour index is only used to tint a star on screen, a
 * class-derived approximation is far better than showing those stars in a default colour that
 * happens to mean "hot and blue-white".
 */

/** Harvard spectral classes, hottest to coolest. */
export const SPECTRAL_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const;

export type SpectralClass = (typeof SPECTRAL_CLASSES)[number];

/**
 * Representative main-sequence B-V colour index at subclass 0 of each class, plus a terminal
 * anchor past M9 so the coolest subclasses have something to interpolate toward. Standard
 * textbook values; precise enough for a colour tint, not for photometry.
 */
const COLOR_INDEX_ANCHORS: Readonly<Record<SpectralClass, number>> = {
  O: -0.33,
  B: -0.3,
  A: 0.0,
  F: 0.3,
  G: 0.58,
  K: 0.81,
  M: 1.4
};

/** B-V at the cool end of class M, used as the upper interpolation bound. */
const BEYOND_M = 2.0;

/**
 * Optional lowercase luminosity prefix (`d` dwarf, `sd` subdwarf, `g` giant, `c` supergiant),
 * stripped only when a class letter follows it immediately. The guard matters for `g-k`, where
 * the leading `g` is the class G opening a range rather than a giant prefix.
 */
const LUMINOSITY_PREFIX = /^(?:sd|[dgc])(?=[OBAFGKMobafgkm])/;

/** Class letter, optional subclass — anchored at the start of what remains. */
const SPECTRAL_CLASS_PATTERN = /^([OBAFGKM])\s*(\d+(?:\.\d+)?)?/;

/**
 * Pulls the spectral class and (optional) numeric subclass out of a catalog string.
 *
 * HYG's `spect` column is inconsistent — `M3.5`, a bare lowercase `m`, `K5 V`, `dM4` with a
 * luminosity prefix, `K:` flagged uncertain, `k-m` for a range. Rather than trying to parse a
 * grammar that does not exist, this strips any luminosity prefix and reads the class off the
 * front. For a range like `k-m` that yields the warmer end, which is the conventional reading.
 *
 * The match is anchored rather than a free scan of the string. Scanning looks tempting and is
 * wrong: the ETL writes the literal `Unknown` for unclassified stars, and that contains a `K`,
 * so a scan silently classifies every unclassified star as an orange K-type.
 */
export function parseSpectralClass(
  spectralType: string | null | undefined
): { spectralClass: SpectralClass; subclass: number } | null {
  const trimmed = (spectralType ?? '').trim().replace(LUMINOSITY_PREFIX, '');
  const match = SPECTRAL_CLASS_PATTERN.exec(trimmed.toUpperCase());
  if (!match) {
    return null;
  }

  const spectralClass = match[1] as SpectralClass;
  const parsed = match[2] === undefined ? 0 : Number(match[2]);
  // Subclasses run 0-9; anything else is a misparse, so fall back to the class midpoint.
  const subclass = Number.isFinite(parsed) && parsed >= 0 && parsed < 10 ? parsed : 0;

  return { spectralClass, subclass };
}

/** Luminosity class I (with Ia, Iab, Ib), II or III, not the I of a IV. */
const GIANT_LUMINOSITY_CLASS = /(?<![IV])(?:III|II|I)(?![IV])/;

/**
 * Whether a spectral type says its star is a giant or supergiant: luminosity class I to III,
 * HYG's `g` or `c` prefix, or a carbon or S star (C, N, R, S), which are all giants on the
 * asymptotic branch whether or not a class is given. Read off the primary only — Antares is
 * `M1Ib + B2.5V`.
 */
export function isGiant(spectralType: string | null | undefined): boolean {
  const primary = (spectralType ?? '').split('+')[0].trim();
  return /^(?:[gc][OBAFGKM]|[CNRS])/.test(primary) || GIANT_LUMINOSITY_CLASS.test(primary);
}

/**
 * Approximate B-V colour index for a spectral type, interpolating between the class anchors by
 * subclass. Returns `null` when no class can be recognised, which is the honest answer for the
 * stars HYG leaves entirely unclassified.
 */
export function spectralTypeToColorIndex(spectralType: string | null | undefined): number | null {
  const parsed = parseSpectralClass(spectralType);
  if (!parsed) {
    return null;
  }

  const { spectralClass, subclass } = parsed;
  const index = SPECTRAL_CLASSES.indexOf(spectralClass);
  const from = COLOR_INDEX_ANCHORS[spectralClass];
  const to = index === SPECTRAL_CLASSES.length - 1 ? BEYOND_M : COLOR_INDEX_ANCHORS[SPECTRAL_CLASSES[index + 1]];

  return from + (to - from) * (subclass / 10);
}

/**
 * B-V colour index for an effective temperature, for stars the Exoplanet Archive gives a
 * temperature but no B magnitude: the dwarf sequence below read the other way, interpolated
 * between the two types the temperature falls between, so that the correction and the temperature
 * read back off the colour are the table's at that temperature. Ballesteros' blackbody fit, used
 * before, runs 0.1 to 0.2 redder than the table below 3 800 K, and the colour it gave was read on
 * the table: 3 500 K came back as 3 102 K with a correction 1.15 magnitudes too large, and the 57
 * hosts placed this way were off the archive's own luminosity by 0.23 dex at the median. `null`
 * outside the table, 2 420 to 31 400 K, rather than a colour clamped to its end — CFBDSIR
 * J145829+101343, a 580 K brown dwarf, read as B−V 2.00 and "~M6".
 */
export function temperatureToColorIndex(temperatureK: number): number | null {
  const [hottest, coolest] = [ROWS_WITH_COLOUR[1][0], DWARF_SEQUENCE[DWARF_SEQUENCE.length - 1]];
  return temperatureK <= hottest[3] && temperatureK >= coolest[3] ? dwarfSequenceAtTemperature(temperatureK).bMinusV : null;
}

/**
 * The mean dwarf sequence: B−V, Gaia BP−RP, effective temperature (K), bolometric correction to V
 * and Gaia G−V by spectral type, from Pecaut & Mamajek (2013, ApJS 208, 9, table 5) as Mamajek
 * maintains it online (version 2022.04.16), where the Gaia columns were added. From O3 to M8.5,
 * past which BP−RP turns back. The O rows, read by type only, carry no colour: B−V stops telling
 * types apart there, the whole O sequence spanning 0.03 of it. BP−RP starts at B9, the bluest it
 * is tabulated for, and G−V at B1.5.
 */
type SequenceRow = readonly [string, number | null, number | null, number, number, number | null];

const DWARF_SEQUENCE: readonly SequenceRow[] = [
  ['O3', null, null, 44900, -4.01, null], ['O4', null, null, 42900, -3.89, null], ['O5', null, null, 41400, -3.76, null],
  ['O5.5', null, null, 40500, -3.67, null], ['O6', null, null, 39500, -3.57, null], ['O6.5', null, null, 38300, -3.49, null],
  ['O7', null, null, 37100, -3.41, null], ['O7.5', null, null, 36100, -3.33, null], ['O8', null, null, 35100, -3.24, null],
  ['O8.5', null, null, 34300, -3.18, null], ['O9', null, null, 33300, -3.11, null], ['O9.5', null, null, 31900, -3.01, null],
  ['B0', -0.301, null, 31400, -2.99, null], ['B0.5', -0.289, null, 29000, -2.83, null], ['B1', -0.278, null, 26000, -2.58, null],
  ['B1.5', -0.252, null, 24500, -2.44, -0.021], ['B2', -0.215, null, 20600, -2.03, -0.008], ['B2.5', -0.198, null, 18500, -1.77, -0.003],
  ['B3', -0.178, null, 17000, -1.54, 0.001], ['B4', -0.165, null, 16400, -1.49, 0.004], ['B5', -0.156, null, 15700, -1.34, 0.007],
  ['B6', -0.14, null, 14500, -1.13, 0.01], ['B7', -0.128, null, 14000, -1.05, 0.012], ['B8', -0.109, null, 12300, -0.73, 0.016],
  ['B9', -0.07, -0.12, 10700, -0.42, 0.018], ['B9.5', -0.05, -0.087, 10400, -0.36, 0.017], ['A0', 0, -0.037, 9700, -0.21, 0.015],
  ['A1', 0.035, 0.005, 9300, -0.14, 0.01], ['A2', 0.07, 0.068, 8800, -0.07, 0], ['A3', 0.1, 0.11, 8600, -0.04, -0.005],
  ['A4', 0.14, 0.166, 8250, -0.02, -0.01], ['A5', 0.16, 0.194, 8100, 0, -0.015], ['A6', 0.185, 0.222, 7910, 0.005, -0.02],
  ['A7', 0.21, 0.263, 7760, 0.01, -0.03], ['A8', 0.25, 0.32, 7590, 0.02, -0.04], ['A9', 0.27, 0.327, 7400, 0.02, -0.05],
  ['F0', 0.295, 0.377, 7220, 0.01, -0.06], ['F1', 0.33, 0.434, 7020, 0.005, -0.07], ['F2', 0.37, 0.49, 6820, -0.005, -0.08],
  ['F3', 0.39, 0.518, 6750, -0.01, -0.09], ['F4', 0.41, 0.546, 6670, -0.015, -0.1], ['F5', 0.44, 0.587, 6550, -0.02, -0.11],
  ['F6', 0.486, 0.64, 6350, -0.03, -0.13], ['F7', 0.5, 0.67, 6280, -0.035, -0.14], ['F8', 0.53, 0.694, 6180, -0.04, -0.15],
  ['F9', 0.56, 0.719, 6050, -0.05, -0.145], ['F9.5', 0.58, 0.767, 5990, -0.06, -0.155], ['G0', 0.595, 0.784, 5930, -0.065, -0.155],
  ['G1', 0.622, 0.803, 5860, -0.073, -0.158], ['G2', 0.65, 0.823, 5770, -0.085, -0.165], ['G3', 0.66, 0.832, 5720, -0.095, -0.167],
  ['G4', 0.67, 0.841, 5680, -0.1, -0.173], ['G5', 0.68, 0.85, 5660, -0.105, -0.179], ['G6', 0.7, 0.869, 5600, -0.115, -0.186],
  ['G7', 0.71, 0.88, 5550, -0.125, -0.194], ['G8', 0.73, 0.9, 5480, -0.14, -0.202], ['G9', 0.775, 0.95, 5380, -0.16, -0.21],
  ['K0', 0.816, 0.983, 5270, -0.195, -0.227], ['K1', 0.857, 1.01, 5170, -0.23, -0.25], ['K2', 0.884, 1.1, 5100, -0.26, -0.27],
  ['K3', 0.99, 1.21, 4830, -0.375, -0.32], ['K4', 1.09, 1.34, 4600, -0.52, -0.42], ['K5', 1.15, 1.43, 4440, -0.63, -0.44],
  ['K6', 1.24, 1.53, 4300, -0.75, -0.51], ['K7', 1.34, 1.7, 4100, -0.93, -0.58], ['K8', 1.363, 1.73, 3990, -1.03, -0.625],
  ['K9', 1.4, 1.79, 3930, -1.07, -0.66], ['M0', 1.42, 1.84, 3850, -1.15, -0.7], ['M0.5', 1.445, 1.97, 3770, -1.29, -0.76],
  ['M1', 1.485, 2.09, 3660, -1.42, -0.82], ['M1.5', 1.495, 2.13, 3620, -1.5, -0.87], ['M2', 1.505, 2.23, 3560, -1.62, -0.925],
  ['M2.5', 1.522, 2.39, 3470, -1.78, -1.02], ['M3', 1.53, 2.5, 3430, -1.93, -1.1], ['M3.5', 1.6, 2.78, 3270, -2.28, -1.28],
  ['M4', 1.65, 2.94, 3210, -2.51, -1.4], ['M4.5', 1.69, 3.16, 3110, -2.84, -1.54], ['M5', 1.83, 3.35, 3060, -3.11, -1.7],
  ['M5.5', 1.94, 3.71, 2930, -3.58, -1.95], ['M6', 2.01, 4.16, 2810, -4.13, -2.37], ['M6.5', 2.07, 4.5, 2740, -4.62, -2.7],
  ['M7', 2.12, 4.65, 2680, -4.99, -2.98], ['M7.5', 2.14, 4.72, 2630, -5.32, -3.15], ['M8', 2.15, 4.86, 2570, -5.65, -3.11],
  ['M8.5', 2.16, 5.1, 2420, -5.78, -3.09]
];

/**
 * The rows each colour is tabulated for, filtered once. Filtered on every call, the search index
 * and the star field's tints, which read the table for each of the 455 571 stars, spent 140-230
 * ms of the main thread on it at boot, and the search index again on each opening of its tab.
 */
const ROWS_WITH_COLOUR = { 1: DWARF_SEQUENCE.filter((row) => row[1] !== null), 2: DWARF_SEQUENCE.filter((row) => row[2] !== null) } as const;

/**
 * The spectral type of the dwarf whose colour is nearest, for the stars no catalogue classified —
 * every Gaia star, 83 % of the map. An estimate, and the caller must say so: it assumes a dwarf,
 * so a giant is given a later type than its own — Pollux, a K0 giant at B−V 0.99, reads as K3 —
 * and it ignores reddening, which makes a star behind dust look later still. `null` for a
 * colour outside the table, rather than the nearest end of it.
 */
export function spectralTypeFromColor(colorIndex: number | null, system: 'B-V' | 'BP-RP' = 'B-V'): string | null {
  const column = system === 'B-V' ? 1 : 2;
  const rows = ROWS_WITH_COLOUR[column];
  if (colorIndex === null || !(colorIndex >= rows[0][column]! && colorIndex <= rows[rows.length - 1][column]!)) {
    return null;
  }
  let nearest = rows[0];
  for (const row of rows) {
    if (Math.abs(row[column]! - colorIndex) < Math.abs(nearest[column]! - colorIndex)) {
      nearest = row;
    }
  }
  return nearest[0];
}

/**
 * A star's classification as a row or an option lists it: the catalogue's type, or the dwarf type
 * its colour matches, marked `~` as an estimate; empty with neither, rather than the ETL's literal
 * "Unknown", which 383 695 stars carry and search rows and route options used to print.
 */
export function spectralClassification(star: { spectralType: string; colorIndex: number | null; colorSystem?: 'B-V' | 'BP-RP' }): string {
  if (star.spectralType && star.spectralType !== 'Unknown') {
    return star.spectralType;
  }
  const estimate = spectralTypeFromColor(star.colorIndex, star.colorSystem);
  return estimate ? `~${estimate}` : '';
}

/** What the dwarf sequence says of a star of a given colour. */
export interface DwarfSequencePoint {
  /** B−V, the colour in the other system's terms where it was read off BP−RP; `null` among the O rows. */
  bMinusV: number | null;
  temperatureK: number;
  /** Bolometric correction to V: what V leaves out of the star's total output, in magnitudes. */
  bolometricCorrectionV: number;
  /** Gaia G − Johnson V; `null` bluer than B1.5, where it is not tabulated. */
  gMinusV: number | null;
}

/**
 * The dwarf sequence read at a colour, interpolated between the two types it falls between — the
 * same table the spectral estimate reads, so a star's temperature and its estimated type agree.
 * Linear rather than nearest, because the red end is steep: B−V runs 1.495 to 1.53 from M1.5 to
 * M3, over which the temperature drops 190 K and the correction 0.4 magnitudes. `null` outside
 * the table, as for the estimate — or, with `clampToTable`, the row at the end the colour is past,
 * except bluer than BP−RP's end, where it is read off {@link WHITE_DWARF_BP_RP}.
 */
export function dwarfSequenceAtColor(colorIndex: number | null, system: 'B-V' | 'BP-RP' = 'B-V', clampToTable = false): DwarfSequencePoint | null {
  const column = system === 'B-V' ? 1 : 2;
  const rows = ROWS_WITH_COLOUR[column];
  const [bluest, reddest] = [rows[0][column]!, rows[rows.length - 1][column]!];
  if (colorIndex === null || !Number.isFinite(colorIndex) || (!clampToTable && !(colorIndex >= bluest && colorIndex <= reddest))) {
    return null;
  }
  if (system === 'BP-RP' && colorIndex < bluest) {
    const next = Math.max(1, WHITE_DWARF_BP_RP.findIndex(([colour]) => colour >= colorIndex));
    const [[blueColour, blueK], [redColour, redK]] = [WHITE_DWARF_BP_RP[next - 1], WHITE_DWARF_BP_RP[next]];
    return dwarfSequenceAtTemperature(blueK + (redK - blueK) * Math.max((colorIndex - blueColour) / (redColour - blueColour), 0));
  }
  return sequenceWhere(rows, (row) => row[column]!, Math.min(Math.max(colorIndex, bluest), reddest));
}

/**
 * Effective temperature by BP−RP past the blue end of the table, which is B9's −0.12: the median
 * pure-hydrogen temperature Gentile Fusillo et al. (2021, MNRAS 508, 3877) fit, in bins of ±0.025,
 * to the 104 of the map's stars there that their white dwarf catalogue has, all white dwarfs; with
 * the table's end, 10 700 K, and their bluest bin held past it. Every one of them was drawn at B9's
 * 10 700 K where they measure 14 266 to 39 304, and at a median 1.53 times the radius their mass
 * and gravity give.
 */
const WHITE_DWARF_BP_RP: readonly (readonly [number, number])[] = [
  [-0.4, 28585], [-0.35, 24521], [-0.3, 22090], [-0.25, 19012], [-0.2, 17079], [-0.15, 15369], [-0.12, 10700]
];

/**
 * The dwarf sequence at a spectral type, between the two rows it falls between, O3 to M8.5; the end
 * row past either end. `null` for a type with no class the parser reads.
 */
export function dwarfSequenceAtType(spectralType: string | null | undefined): DwarfSequencePoint | null {
  const parsed = parseSpectralClass(spectralType);
  return parsed && sequenceWhere(DWARF_SEQUENCE, (row) => TYPE_INDEX.get(row)!, typeIndex(parsed));
}

/** A type as a number rising down the table: ten to a class, O0 at 0. */
function typeIndex({ spectralClass, subclass }: { spectralClass: SpectralClass; subclass: number }): number {
  return SPECTRAL_CLASSES.indexOf(spectralClass) * 10 + subclass;
}

const TYPE_INDEX = new Map(DWARF_SEQUENCE.map((row) => [row, typeIndex(parseSpectralClass(row[0])!)]));

/** The dwarf sequence at an effective temperature, between the two types it falls between; the end row past either end. */
export function dwarfSequenceAtTemperature(temperatureK: number): DwarfSequencePoint {
  return sequenceWhere(ROWS_WITH_COLOUR[1], (row) => -row[3], -temperatureK);
}

/** The sequence where `key`, rising down `rows`, reaches `value`: linear between the two rows either side, the end row past either end. */
function sequenceWhere(rows: readonly SequenceRow[], key: (row: SequenceRow) => number, value: number): DwarfSequencePoint {
  const next = rows.findIndex((row) => key(row) >= value);
  const [first, second] = next === -1 ? [rows[rows.length - 2], rows[rows.length - 1]] : [rows[Math.max(next, 1) - 1], rows[Math.max(next, 1)]];
  const t = Math.min(Math.max((value - key(first)) / (key(second) - key(first)), 0), 1);
  const lerp = (from: number, to: number): number => from + (to - from) * t;
  return {
    bMinusV: first[1] === null || second[1] === null ? null : lerp(first[1], second[1]),
    temperatureK: lerp(first[3], second[3]),
    bolometricCorrectionV: lerp(first[4], second[4]),
    gMinusV: first[5] === null || second[5] === null ? null : lerp(first[5], second[5])
  };
}
