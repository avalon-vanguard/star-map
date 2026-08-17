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
