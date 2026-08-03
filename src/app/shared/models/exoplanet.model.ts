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
  orbit: Partial<OrbitalElements>;
}
