/**
 * A single star from Gaia DR3, HYG (Hipparcos/Yale/Gliese) or the NASA Exoplanet Archive — see
 * `source` — positioned relative to the
 * Sun in the galaxy-scale coordinate system (parsecs). The same positions are also packed
 * into a compact binary buffer (`stars.bin`, in index order) for fast bulk rendering; this
 * record format (`stars-index.json`) is used for search, labels, and lookups by id/name.
 */
export interface StarRecord {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  magnitude: number;
  spectralType: string;
  /**
   * Colour index — B-V, or Gaia's BP-RP where `colorSystem` says so — or `null` where the
   * catalog has no photometry. Deliberately nullable rather than defaulted: `0` is a real,
   * meaningful colour index (a hot blue-white A-type star), so using it to stand for "unknown"
   * silently mis-colours those stars. Consumers resolve the gap from `spectralType`; see
   * `colorIndexToRgb`.
   */
  colorIndex: number | null;
  /**
   * The band `magnitude` was measured in: Johnson V (HYG, and the archive where it has one) or
   * Gaia's G, which for a red dwarf reads up to three magnitudes brighter than V. Absent where no
   * survey measured the star and `magnitude` is the ETL's stand-in.
   */
  magnitudeBand?: 'V' | 'G';
  /**
   * Which colour `colorIndex` is: Johnson B−V, or Gaia's BP−RP, which is larger for the same star
   * — 0.82 against 0.65 for a G2 dwarf like the Sun, 3.35 against 1.83 for an M5 dwarf (Pecaut &
   * Mamajek). Absent with it.
   */
  colorSystem?: 'B-V' | 'BP-RP';
  /**
   * Whether `colorIndex` was read off the dwarf sequence at the star's effective temperature rather
   * than measured: 54 archive-placed hosts with a temperature and no B or V magnitude. Three more,
   * whose temperatures are outside the table, have no colour at all.
   */
  colorFromTemperature?: boolean;
  /**
   * Relative uncertainty of the distance, σd/d: the relative error of the parallax it was
   * inverted from, which to first order is the same — or, for a star the Exoplanet Archive places,
   * the mean of the two one-sided errors it gives on the distance itself, which is often no
   * parallax's. Absent where none was published.
   */
  distanceError?: number;
  /** Whether the distance is Gaia DR3's parallax, whichever catalogue describes the star. */
  distanceFromGaia?: boolean;
  /**
   * Which catalogue this star's position came from, once more than one contributes. Absent for a
   * single-source build; see `star-merge.ts`, where overlapping catalogues are reconciled and
   * the better-measured parallax wins.
   */
  source?: string;
  /**
   * Proper motion in milliarcseconds a year, in right ascension (times cos δ) and declination,
   * where the source measured one. Only the ETL sets these, for `star-merge.ts` to recognise two
   * entries of one star whose positions disagree; the assets do not carry them.
   */
  pmRaMasYr?: number;
  pmDecMasYr?: number;
  /**
   * The Gaia DR3 source a Gaia entry is, kept once a HYG row has named it: what `foldByIdentity`
   * looks up a star SIMBAD identifies by. Only the ETL sets it; the assets do not carry it.
   */
  gaiaDesignation?: string;
}

/** HYG id used for the Sun itself, so solar-system bodies can reference their host star. */
export const SUN_STAR_ID = 0;
