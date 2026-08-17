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
  radiusKm?: number;
  massEarth?: number;
  discoveryYear?: number;
  orbit: Partial<OrbitalElements>;
  /**
   * What this world is inferred to look like, and the quantities that inference rests on. Always
   * present — every body has measurements enough to place it somewhere — but its individual
   * fields are nullable, since a body whose host star is not in the catalogue has no derived
   * temperature.
   */
  appearance: PlanetAppearance;
  /** True when a real photograph is being shown rather than the derived surface. */
  hasPhotography: boolean;
}
