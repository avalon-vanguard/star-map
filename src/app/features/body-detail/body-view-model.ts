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
 *
 * None where no survey measured the star and its magnitude is the ETL's stand-in, which is all
 * 309 stars without a band have. The 265 archive hosts among them came out at a median 33 L☉
 * from it, KMT-2016-BLG-1107L, a 0.087 M☉ star, at 37, and OGLE-2005-BLG-390L b, published at
 * about 50 K, read 388 K. The Sun is the unit, whatever its magnitude is filed under.
 */
export function luminosityOf(star: StarRecord | undefined): number | null {
  return star && (star.magnitudeBand || star.id === SUN_STAR_ID) ? luminositySolar(photometryOf(star)) : null;
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

/** How big, how hot and how bright a star is, and whether each was measured or derived here. */
export interface StarSurface {
  /** Solar radii; `null` without a published radius, a measured magnitude, and a colour or type. */
  radiusSolar: number | null;
  radiusDerived: boolean;
  temperatureK: number | null;
  /** Solar luminosities, what its planets are warmed by; `null` where there is neither. */
  luminositySolar: number | null;
  luminosityDerived: boolean;
}

/**
 * The temperature each host's disc is drawn at where the archive gives one, by star id: the first
 * among its planets, in their order, as {@link starSurfaceOf} takes it — for the star field, which
 * tints every star the colour of its own disc.
 */
export function publishedTemperaturesK(exoplanets: readonly ExoplanetRecord[]): Map<number, number> {
  const temperatures = new Map<number, number>();
  for (const { hostStarId, hostStarTemperatureK } of exoplanets) {
    if (hostStarId !== null && hostStarTemperatureK && !temperatures.has(hostStarId)) {
      temperatures.set(hostStarId, hostStarTemperatureK);
    }
  }
  return temperatures;
}

/**
 * A star's radius, effective temperature and luminosity: the archive's `st_rad`, `st_teff` and
 * `st_lum` for a planet host, from any of its planets' rows, and otherwise derived — the
 * temperature off the dwarf sequence at the star's colour, the luminosity from its magnitude
 * (`luminosityOf`), the radius from those two (Stefan-Boltzmann). The Sun's are its own, the
 * nominal values the rest are measured in.
 *
 * Derived radii land within a factor of 1.5 of the archive's for 97 % of the 1 447 catalogue
 * hosts that have both, and within 0.018 dex at the median. Derived luminosities fare worse: 757
 * of the 4 440 hosts the archive gives one for were off by more than that factor, 667 of them
 * stars placed from the archive's own V and B−V, and Proxima read 8.9×10⁻⁴ L☉ against the
 * archive's 1.51×10⁻³ beside the radius and temperature it was drawn with, which imply 1.27×10⁻³.
 */
export function starSurfaceOf(star: StarRecord, planets: readonly ExoplanetRecord[]): StarSurface {
  if (star.id === SUN_STAR_ID) {
    return { radiusSolar: 1, radiusDerived: false, temperatureK: SOLAR_EFFECTIVE_TEMPERATURE_K, luminositySolar: 1, luminosityDerived: false };
  }
  const temperatureK = planets.find((planet) => planet.hostStarTemperatureK)?.hostStarTemperatureK ?? effectiveTemperatureK(photometryOf(star));
  const published = planets.find((planet) => planet.hostStarLuminositySolar)?.hostStarLuminositySolar;
  // None from a stand-in magnitude: PSR J1719-1438 came out 2.3 solar radii, wider than its
  // planet's orbit.
  const derived = luminosityOf(star);
  const luminosity = { luminositySolar: published ?? derived, luminosityDerived: published === undefined };
  const measured = planets.find((planet) => planet.hostStarRadiusSolar)?.hostStarRadiusSolar;
  if (measured) {
    return { radiusSolar: measured, radiusDerived: false, temperatureK, ...luminosity };
  }
  return {
    radiusSolar: derived !== null && temperatureK !== null ? radiusFromLuminositySolar(derived, temperatureK) : null,
    radiusDerived: true,
    temperatureK,
    ...luminosity,
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
      semiAxesKm: body.semiAxesKm,
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
    // Warmed by what the system view warms it by: the archive's luminosity where it has one.
    appearance: appearanceForExoplanet(
      exoplanet,
      hostStar ? starSurfaceOf(hostStar, catalogues.exoplanets.filter((candidate) => candidate.hostStarId === hostStar.id)).luminositySolar : null,
    ),
    hasPhotography: bodyTexturePath(exoplanet.id) !== undefined,
    imaged: exoplanet.imaged,
    // `periodDays` is populated for none of the shipped records, and deriving one would need the
    // host star's mass, which is equally absent. Left undefined rather than assuming a solar-mass
    // host, which would silently mis-state the period of every planet around an M dwarf.
    orbitalPeriodDays: exoplanet.periodDays,
    orbitalPeriodSource: exoplanet.periodDays === undefined ? undefined : 'measured',
  };
}
