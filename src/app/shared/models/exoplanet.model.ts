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
   * The host star's own published position (`ra`, `dec`, `sy_dist`) — the coordinates the
   * cross-reference above is resolved from.
   *
   * Kept rather than consumed and discarded. `hostStarId` is the *result* of a match against
   * whatever star catalogue was loaded at the time, so widening that catalogue ought to rescue
   * some of the 4347 hosts that currently resolve to nothing — but with only the result stored,
   * redoing the match meant re-downloading the archive. These three numbers make it a local
   * operation. See `rematchHostStars`.
   */
  hostRaDeg?: number;
  hostDecDeg?: number;
  hostDistancePc?: number;
  orbit: Partial<OrbitalElements>;
}
