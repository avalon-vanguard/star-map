import { OrbitalElements } from './body.model';

/**
 * A confirmed exoplanet from the NASA Exoplanet Archive (`Planetary Systems` TAP table),
 * cross-referenced to its host star in the star catalogue.
 */
export interface ExoplanetRecord {
  id: string;
  /**
   * The host's star-catalogue id: a HYG or Gaia star it was matched to, or else a star the ETL
   * added from the archive's own figures. Null only when the archive gives no position and
   * distance to place one with.
   */
  hostStarId: number | null;
  hostStarName: string;
  name: string;
  radiusEarth?: number;
  massEarth?: number;
  discoveryYear?: number;
  /**
   * True where the archive flags the planet as detected by imaging (`ima_flag`): photographed as a
   * point of light beside its star, as HR 8799's four planets were. Absent for every other planet.
   */
  imaged?: true;
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
   * luminosity in solar luminosities (10^`st_lum`), where the archive gives them: from the
   * composite table (pscomppars) alone, since the default-row query does not ask for these three,
   * and each column of it may come from a different reference — Proxima's 0.141 R☉ is one.
   * Preferred to what `stellar.ts` would derive; see `starSurfaceOf`.
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
