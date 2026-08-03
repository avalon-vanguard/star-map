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
  colorIndex: number;
}

/** HYG id used for the Sun itself, so solar-system bodies can reference their host star. */
export const SUN_STAR_ID = 0;
