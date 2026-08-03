/**
 * Osculating Keplerian orbital elements at a reference epoch. Positions are derived
 * client-side by propagating these elements forward/backward from `epochJd` (see
 * `shared/astro/kepler.ts`), rather than fetching per-frame positions.
 */
export interface OrbitalElements {
  semiMajorAxisAu: number;
  eccentricity: number;
  inclinationDeg: number;
  longitudeOfAscendingNodeDeg: number;
  argumentOfPeriapsisDeg: number;
  meanAnomalyAtEpochDeg: number;
  epochJd: number;
}

/**
 * A solar-system planet, moon, or dwarf planet, sourced from JPL Horizons/SSD orbital
 * elements. `systemStarId` links back to the HYG star index (the Sun, see `SUN_STAR_ID`).
 */
export interface BodyRecord {
  id: string;
  systemStarId: number;
  name: string;
  kind: 'planet' | 'moon' | 'dwarf';
  radiusKm: number;
  orbit: OrbitalElements;
  /**
   * For `kind: 'moon'`, the `id` of the planet it orbits — its `orbit` is expressed
   * relative to that planet, not heliocentrically. Undefined for planets/dwarfs.
   */
  parentBodyId?: string;
}
