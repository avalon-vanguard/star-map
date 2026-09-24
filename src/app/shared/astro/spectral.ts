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
 * temperature but no B magnitude. Inverts Ballesteros (2012), T = 4600 K · (1 / (0.92 (B-V) +
 * 1.7) + 1 / (0.92 (B-V) + 0.62)), a blackbody fit good to a few per cent from A to early M: it
 * puts the Sun's 5 772 K at 0.65, which is the Sun's own. Clamped to the range the class anchors
 * above span, because the fit runs on past it — TRAPPIST-1's 2 566 K would come out at 2.7.
 */
export function temperatureToColorIndex(temperatureK: number): number | null {
  if (!Number.isFinite(temperatureK) || temperatureK <= 0) {
    return null;
  }
  // With x = 0.92 (B-V) and k = T / 4600 the fit is k x² + (2.32 k - 2) x + (1.054 k - 2.32) = 0,
  // whose larger root is the physical one.
  const k = temperatureK / 4600;
  const b = 2.32 * k - 2;
  const c = 1.054 * k - 2.32;
  const x = (-b + Math.sqrt(b * b - 4 * k * c)) / (2 * k);
  return Math.min(BEYOND_M, Math.max(COLOR_INDEX_ANCHORS.O, x / 0.92));
}

/**
 * Mean dwarf colours by spectral type: B−V and Gaia BP−RP, from Pecaut & Mamajek (2013, ApJS 208,
 * 9, table 5) as Mamajek maintains it online (version 2022.04.16), where the BP−RP column was
 * added. From B0, where B−V stops telling types apart — the whole O sequence spans 0.03 of it —
 * to M8.5, past which BP−RP turns back; BP−RP starts at B9, the bluest it is tabulated for.
 */
const DWARF_COLOURS: readonly (readonly [string, number, number | null])[] = [
  ['B0', -0.301, null], ['B0.5', -0.289, null], ['B1', -0.278, null], ['B1.5', -0.252, null],
  ['B2', -0.215, null], ['B2.5', -0.198, null], ['B3', -0.178, null], ['B4', -0.165, null],
  ['B5', -0.156, null], ['B6', -0.14, null], ['B7', -0.128, null], ['B8', -0.109, null],
  ['B9', -0.07, -0.12], ['B9.5', -0.05, -0.087], ['A0', 0, -0.037], ['A1', 0.035, 0.005],
  ['A2', 0.07, 0.068], ['A3', 0.1, 0.11], ['A4', 0.14, 0.166], ['A5', 0.16, 0.194],
  ['A6', 0.185, 0.222], ['A7', 0.21, 0.263], ['A8', 0.25, 0.32], ['A9', 0.27, 0.327],
  ['F0', 0.295, 0.377], ['F1', 0.33, 0.434], ['F2', 0.37, 0.49], ['F3', 0.39, 0.518],
  ['F4', 0.41, 0.546], ['F5', 0.44, 0.587], ['F6', 0.486, 0.64], ['F7', 0.5, 0.67],
  ['F8', 0.53, 0.694], ['F9', 0.56, 0.719], ['F9.5', 0.58, 0.767], ['G0', 0.595, 0.784],
  ['G1', 0.622, 0.803], ['G2', 0.65, 0.823], ['G3', 0.66, 0.832], ['G4', 0.67, 0.841],
  ['G5', 0.68, 0.85], ['G6', 0.7, 0.869], ['G7', 0.71, 0.88], ['G8', 0.73, 0.9],
  ['G9', 0.775, 0.95], ['K0', 0.816, 0.983], ['K1', 0.857, 1.01], ['K2', 0.884, 1.1],
  ['K3', 0.99, 1.21], ['K4', 1.09, 1.34], ['K5', 1.15, 1.43], ['K6', 1.24, 1.53],
  ['K7', 1.34, 1.7], ['K8', 1.363, 1.73], ['K9', 1.4, 1.79], ['M0', 1.42, 1.84],
  ['M0.5', 1.445, 1.97], ['M1', 1.485, 2.09], ['M1.5', 1.495, 2.13], ['M2', 1.505, 2.23],
  ['M2.5', 1.522, 2.39], ['M3', 1.53, 2.5], ['M3.5', 1.6, 2.78], ['M4', 1.65, 2.94],
  ['M4.5', 1.69, 3.16], ['M5', 1.83, 3.35], ['M5.5', 1.94, 3.71], ['M6', 2.01, 4.16],
  ['M6.5', 2.07, 4.5], ['M7', 2.12, 4.65], ['M7.5', 2.14, 4.72], ['M8', 2.15, 4.86],
  ['M8.5', 2.16, 5.1]
];

/**
 * The spectral type of the dwarf whose colour is nearest, for the stars no catalogue classified —
 * every Gaia star, 83 % of the map. An estimate, and the caller must say so: it assumes a dwarf,
 * so a giant is given a later type than its own — Pollux, a K0 giant at B−V 0.99, reads as K3 —
 * and it ignores reddening, which makes a star behind dust look later still. `null` for a
 * colour outside the table, rather than the nearest end of it.
 */
export function spectralTypeFromColor(colorIndex: number | null, system: 'B-V' | 'BP-RP' = 'B-V'): string | null {
  const column = system === 'B-V' ? 1 : 2;
  const rows = DWARF_COLOURS.filter((row) => row[column] !== null);
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
