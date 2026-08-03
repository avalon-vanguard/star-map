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
}
