/**
 * A single star from the HYG (Hipparcos/Yale/Gliese) catalog, positioned relative to the
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
   * B-V colour index, or `null` where the catalog has no photometry — about 10% of stars
   * within the distance cutoff. Deliberately nullable rather than defaulted: `0` is a real,
   * meaningful colour index (a hot blue-white A-type star), so using it to stand for "unknown"
   * silently mis-colours those stars. Consumers resolve the gap from `spectralType`; see
   * `colorIndexToRgb`.
   */
  colorIndex: number | null;
}

/** HYG id used for the Sun itself, so solar-system bodies can reference their host star. */
export const SUN_STAR_ID = 0;
