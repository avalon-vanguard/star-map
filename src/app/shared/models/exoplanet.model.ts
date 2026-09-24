import { OrbitalElements } from './body.model';

/**
 * A confirmed exoplanet from the NASA Exoplanet Archive (`Planetary Systems` TAP table),
 * cross-referenced to its host star in the star catalogue.
 */
export interface ExoplanetRecord {
  id: string;
  /**
   * The host's star-catalogue id, the HYG or Gaia star it was matched to; null when none is.
   */
  hostStarId: number | null;
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
   * The host's radius in solar radii (`st_rad`), effective temperature in kelvin (`st_teff`) and
   * luminosity in solar luminosities (10^`st_lum`), where the archive gives them: the planet's
   * default row first, then the composite table, whose columns may each come from a different
   * reference. Measured, where `stellar.ts` otherwise derives a luminosity from V and distance.
   */
  hostStarRadiusSolar?: number;
  hostStarTemperatureK?: number;
  hostStarLuminositySolar?: number;
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
