import { appearanceForBody, appearanceForExoplanet } from '../../shared/astro/body-appearance';
import { EARTH_RADIUS_KM } from '../../shared/astro/planet-appearance';
import { luminositySolar } from '../../shared/astro/stellar';
import { bodyTexturePath } from '../../shared/rendering/texture-catalog';
import { BodyRecord } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { BodyDetailViewModel } from './body-detail.model';

/** Everything the view model is assembled from — the three catalogues, already loaded. */
export interface BodyCatalogues {
  readonly bodies: readonly BodyRecord[];
  readonly exoplanets: readonly ExoplanetRecord[];
  readonly stars: readonly StarRecord[];
}

/**
 * Bolometric luminosity of a star in solar units, from what the catalogue measured: apparent
 * magnitude, parallax distance, and a bolometric correction read off the spectral type.
 */
export function luminosityOf(star: StarRecord | undefined): number | null {
  if (!star) {
    return null;
  }
  return luminositySolar({
    magnitude: star.magnitude,
    distancePc: Math.hypot(star.x, star.y, star.z),
    spectralType: star.spectralType,
  });
}

/**
 * Builds the flattened view model for one body or exoplanet.
 *
 * Shared rather than duplicated per surface: the in-map card and the full detail page show
 * overlapping subsets of the same quantities, and two independent assemblies of "what do we
 * know about this world" is exactly the shape of bug where a planet reads 255 K in one panel
 * and 254 K in the other.
 */
export function buildBodyViewModel(id: string, catalogues: BodyCatalogues): BodyDetailViewModel | undefined {
  const body = catalogues.bodies.find((candidate) => candidate.id === id);
  if (body) {
    const hostStar = catalogues.stars.find((star) => star.id === body.systemStarId);
    // The period the map draws, moons included: JPL's own mean motion, which is also what
    // carries the body round the scene. Europa's card had no period at all while the scene
    // turned it round Jupiter in 3.55 days.
    const periodDays = 360 / body.rates.meanMotionDegPerDay;
    return {
      id: body.id,
      name: body.name,
      kind: body.kind,
      hostStarName: hostStar?.name ?? 'Unknown star',
      hostStarId: body.systemStarId,
      radiusKm: body.radiusKm,
      orbit: body.measuredEccentricity === undefined ? body.orbit : { ...body.orbit, eccentricity: body.measuredEccentricity },
      appearance: appearanceForBody(body, catalogues.bodies, luminosityOf(hostStar)),
      hasPhotography: bodyTexturePath(body.id) !== undefined,
      orbitalPeriodDays: periodDays,
      orbitalPeriodSource: 'measured',
      orbitSource: body.orbitSource,
    };
  }

  const exoplanet = catalogues.exoplanets.find((candidate) => candidate.id === id);
  if (!exoplanet) {
    return undefined;
  }
  const hostStar = catalogues.stars.find((star) => star.id === exoplanet.hostStarId);
  return {
    id: exoplanet.id,
    name: exoplanet.name,
    kind: 'exoplanet',
    hostStarName: exoplanet.hostStarName,
    hostStarId: exoplanet.hostStarId ?? undefined,
    radiusKm: exoplanet.radiusEarth ? exoplanet.radiusEarth * EARTH_RADIUS_KM : undefined,
    massEarth: exoplanet.massEarth,
    discoveryYear: exoplanet.discoveryYear,
    orbit: exoplanet.orbit,
    appearance: appearanceForExoplanet(exoplanet, luminosityOf(hostStar)),
    hasPhotography: bodyTexturePath(exoplanet.id) !== undefined,
    // `periodDays` is populated for none of the shipped records, and deriving one would need the
    // host star's mass, which is equally absent. Left undefined rather than assuming a solar-mass
    // host, which would silently mis-state the period of every planet around an M dwarf.
    orbitalPeriodDays: exoplanet.periodDays,
    orbitalPeriodSource: exoplanet.periodDays === undefined ? undefined : 'measured',
  };
}
