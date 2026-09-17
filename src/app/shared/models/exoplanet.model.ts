import { OrbitalElements } from './body.model';

/**
 * A confirmed exoplanet from the NASA Exoplanet Archive (`Planetary Systems` TAP table),
 * cross-referenced to its host star in the HYG index where possible.
 */
export interface ExoplanetRecord {
  id: string;
  hostStarId: number | null; // null if the host star could not be cross-referenced to HYG
  hostStarName: string;
  name: string;
  radiusEarth?: number;
  massEarth?: number;
  discoveryYear?: number;
  /**
   * Measured orbital period in days (`pl_orbper`). Together with the semi-major axis this
   * pins the host star's gravitational parameter exactly, so the planet can be propagated at
   * its real rate instead of as though it orbited the Sun — see `resolveGravitationalParameter`.
   */
  periodDays?: number;
  /** Host star mass in solar masses (`st_mass`); the fallback when no period is published. */
  hostStarMassSolar?: number;
  /**
   * The host star's own published astrometry (`ra`, `dec`, `sy_dist`, `sy_pmra`, `sy_pmdec`) —
   * everything the cross-reference above was resolved from.
   *
   * Kept rather than consumed and discarded. `hostStarId` is the *result* of a match against
   * whatever star catalogue was loaded at the time; keeping the inputs makes auditing or
   * redoing that match a local operation instead of a TAP query against an archive that is not
   * always reachable — it is how the matcher's tolerances were measured. See
   * `resolveHostStarId`.
   */
  hostRaDeg?: number;
  hostDecDeg?: number;
  hostDistancePc?: number;
  hostPmRaMasPerYear?: number;
  hostPmDecMasPerYear?: number;
  orbit: Partial<OrbitalElements>;
}
