import { PlanetAppearance } from '../../shared/astro/planet-appearance';
import { OrbitalElements } from '../../shared/models/body.model';

export type BodyDetailKind = 'planet' | 'moon' | 'dwarf' | 'exoplanet';

/**
 * Flattened view model combining the fields `InfoPanelComponent` displays, regardless of
 * whether the selected body came from `bodies.json` (solar-system `BodyRecord`) or
 * `exoplanets.json` (`ExoplanetRecord`) — the two sources report different subsets of data.
 */
export interface BodyDetailViewModel {
  id: string;
  name: string;
  kind: BodyDetailKind;
  hostStarName: string;
  /**
   * The host star's catalogue id, so a caller that has the view model does not have to rescan the
   * catalogues to find what building it already resolved. Undefined for an exoplanet whose host
   * never cross-referenced to the star catalogue.
   */
  hostStarId?: number;
  radiusKm?: number;
  /** A triaxial body's semi-axes, where `radiusKm` is the mean of them; see `BodyRecord.semiAxesKm`. */
  semiAxesKm?: readonly [number, number, number];
  massEarth?: number;
  discoveryYear?: number;
  orbit: Partial<OrbitalElements>;
  /**
   * What this world is inferred to look like, and the quantities that inference rests on. Always
   * present — every body has measurements enough to place it somewhere — but its individual
   * fields are nullable, since a body whose host star's luminosity or whose orbit's size is not
   * known has no derived temperature.
   */
  appearance: PlanetAppearance;
  /** True when a real photograph is being shown rather than the derived surface. */
  hasPhotography: boolean;
  /** An exoplanet photographed by direct imaging, as a point of light; see `ExoplanetRecord.imaged`. */
  imaged?: boolean;
  /**
   * Sidereal orbital period. For a solar-system body, 360 degrees over JPL's published mean
   * motion; for an exoplanet, the archive's period where it published one, and undefined where not.
   */
  orbitalPeriodDays?: number;
  /**
   * Which of those two the period is, so the surfaces can file it under the right heading. A
   * derived period presented as an observation is the same category of error as presenting a
   * derived surface as a photograph.
   */
  orbitalPeriodSource?: 'measured' | 'derived';
  /** Where the orbit comes from and the span it holds over; see `BodyRecord.orbitSource`. */
  orbitSource?: string;
}
