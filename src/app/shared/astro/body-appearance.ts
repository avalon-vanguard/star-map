import { BodyRecord } from '../models/body.model';
import { ExoplanetRecord } from '../models/exoplanet.model';
import { EARTH_RADIUS_KM, PlanetAppearance, planetAppearance } from './planet-appearance';

/**
 * Adapters from the two record shapes this app carries to the appearance derivation.
 *
 * They exist because the two sources publish different things. The Exoplanet Archive gives a
 * radius and a mass in Earth units and a semi-major axis around the host star. Horizons gives a
 * radius in kilometres, no mass at all, and — for a moon — a semi-major axis around its
 * *planet* rather than around the Sun. Feeding a moon's own orbit into an equilibrium
 * temperature would put Europa a few thousandths of an AU from the Sun and melt it.
 */

/**
 * Distance from the host star at which a body actually sits, in AU.
 *
 * For a moon that is its planet's distance, not its own: the tiny orbit around the planet is
 * irrelevant to how much starlight reaches it, and using it would be off by three orders of
 * magnitude.
 */
export function heliocentricDistanceAu(body: BodyRecord, bodies: readonly BodyRecord[]): number | undefined {
  if (!body.parentBodyId) {
    return body.orbit.semiMajorAxisAu;
  }
  return bodies.find((candidate) => candidate.id === body.parentBodyId)?.orbit.semiMajorAxisAu;
}

/**
 * Appearance of a solar-system body.
 *
 * Horizons publishes no masses, so these worlds have no derived density and are classified on
 * size and temperature alone. That is enough for what it decides here: at Jupiter's distance
 * from the Sun the question is never whether a moon is rock or iron, it is whether its surface
 * is ice, and the temperature answers that on its own.
 */
export function appearanceForBody(body: BodyRecord, bodies: readonly BodyRecord[], hostLuminositySolar: number | null | undefined): PlanetAppearance {
  return planetAppearance({
    id: body.id,
    radiusEarth: body.radiusKm ? body.radiusKm / EARTH_RADIUS_KM : undefined,
    semiMajorAxisAu: heliocentricDistanceAu(body, bodies),
    hostLuminositySolar
  });
}

/** Appearance of an exoplanet, from the archive's published radius, mass and orbit. */
export function appearanceForExoplanet(exoplanet: ExoplanetRecord, hostLuminositySolar: number | null | undefined): PlanetAppearance {
  return planetAppearance({
    id: exoplanet.id,
    radiusEarth: exoplanet.radiusEarth,
    massEarth: exoplanet.massEarth,
    semiMajorAxisAu: exoplanet.orbit.semiMajorAxisAu,
    hostLuminositySolar
  });
}
