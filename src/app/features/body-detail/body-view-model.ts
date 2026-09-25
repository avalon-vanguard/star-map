import { appearanceForBody, appearanceForExoplanet } from '../../shared/astro/body-appearance';
import { EARTH_RADIUS_KM } from '../../shared/astro/planet-appearance';
import { effectiveTemperatureK, luminositySolar, radiusFromLuminositySolar, SOLAR_EFFECTIVE_TEMPERATURE_K, StellarPhotometry } from '../../shared/astro/stellar';
import { bodyTexturePath } from '../../shared/rendering/texture-catalog';
import { BodyRecord } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord, SUN_STAR_ID } from '../../shared/models/star.model';
import { BodyDetailViewModel } from './body-detail.model';

/** Everything the view model is assembled from — the three catalogues, already loaded. */
export interface BodyCatalogues {
  readonly bodies: readonly BodyRecord[];
  readonly exoplanets: readonly ExoplanetRecord[];
  readonly stars: readonly StarRecord[];
}

/**
 * Bolometric luminosity of a star in solar units, from what the catalogue measured: apparent
 * magnitude in its band, parallax distance, and a bolometric correction read off the colour, or
 * off the spectral type where there is no colour.
 */
export function luminosityOf(star: StarRecord | undefined): number | null {
  return star ? luminositySolar(photometryOf(star)) : null;
}

function photometryOf(star: StarRecord): StellarPhotometry {
  return {
    magnitude: star.magnitude,
    distancePc: Math.hypot(star.x, star.y, star.z),
    spectralType: star.spectralType,
    magnitudeBand: star.magnitudeBand,
    colorIndex: star.colorIndex,
    colorSystem: star.colorSystem,
  };
}

/** How big and how hot a star is, and whether the radius was measured or derived here. */
export interface StarSurface {
  /** Solar radii; `null` without a published radius, a measured magnitude, and a colour or type. */
  radiusSolar: number | null;
  radiusDerived: boolean;
  temperatureK: number | null;
}

/**
 * A star's radius and effective temperature: the archive's `st_rad` and `st_teff` for a planet
 * host, from any of its planets' rows, and otherwise derived — the temperature off the dwarf
 * sequence at the star's colour, the radius from that and the luminosity (Stefan-Boltzmann).
 * The Sun's are its own, the nominal values the rest are measured in.
 *
 * Derived radii land within a factor of 1.5 of the archive's for 97 % of the 1 447 catalogue
 * hosts that have both, and within 0.018 dex at the median.
 */
export function starSurfaceOf(star: StarRecord, planets: readonly ExoplanetRecord[]): StarSurface {
  if (star.id === SUN_STAR_ID) {
    return { radiusSolar: 1, radiusDerived: false, temperatureK: SOLAR_EFFECTIVE_TEMPERATURE_K };
  }
  const temperatureK = planets.find((planet) => planet.hostStarTemperatureK)?.hostStarTemperatureK ?? effectiveTemperatureK(photometryOf(star));
  const measured = planets.find((planet) => planet.hostStarRadiusSolar)?.hostStarRadiusSolar;
  if (measured) {
    return { radiusSolar: measured, radiusDerived: false, temperatureK };
  }
  // Not from the ETL's stand-in magnitude, which is all 309 stars without a band have: PSR
  // J1719-1438 came out 2.3 solar radii, wider than its planet's orbit.
  const luminosity = star.magnitudeBand ? luminosityOf(star) : null;
  return {
    radiusSolar: luminosity !== null && temperatureK !== null ? radiusFromLuminositySolar(luminosity, temperatureK) : null,
    radiusDerived: true,
    temperatureK,
  };
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
    const periodDays = heliocentricPeriodDays(body);
    return {
      id: body.id,
      name: body.name,
      kind: body.kind,
      hostStarName: hostStar?.name ?? 'Unknown star',
      hostStarId: body.systemStarId,
      radiusKm: body.radiusKm,
      orbit: body.orbit,
      appearance: appearanceForBody(body, catalogues.bodies, luminosityOf(hostStar)),
      hasPhotography: bodyTexturePath(body.id) !== undefined,
      orbitalPeriodDays: periodDays,
      orbitalPeriodSource: periodDays === undefined ? undefined : 'derived',
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

/**
 * Kepler's third law for a body orbiting the Sun: P² = a³ with P in years and a in AU, which
 * holds exactly in these units because the Sun's mass is the unit of mass.
 *
 * Only for heliocentric orbits. A moon's elements are relative to its parent planet, whose mass
 * the catalogue does not carry, so the same arithmetic there would be wrong by the ratio of the
 * planet's mass to the Sun's — a factor of a thousand for Jupiter.
 */
export function heliocentricPeriodDays(body: BodyRecord): number | undefined {
  if (body.parentBodyId !== undefined || body.systemStarId !== SUN_STAR_ID) {
    return undefined;
  }
  const a = body.orbit.semiMajorAxisAu;
  return a > 0 ? Math.pow(a, 1.5) * 365.25 : undefined;
}
