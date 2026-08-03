const DEG_TO_RAD = Math.PI / 180;
const HOURS_TO_DEG = 15;

export interface CartesianCoordinates {
  x: number;
  y: number;
  z: number;
}

/**
 * Converts right ascension (hours), declination (degrees) and distance (parsecs) into
 * equatorial Cartesian coordinates (parsecs). Matches the HYG database convention:
 * +X toward the vernal equinox (epoch 2000), +Z toward the north celestial pole,
 * +Y toward RA 6h / Dec 0.
 */
export function raDecDistanceToXyz(raHours: number, decDeg: number, distancePc: number): CartesianCoordinates {
  const raRad = raHours * HOURS_TO_DEG * DEG_TO_RAD;
  const decRad = decDeg * DEG_TO_RAD;
  const cosDec = Math.cos(decRad);

  return {
    x: distancePc * cosDec * Math.cos(raRad),
    y: distancePc * cosDec * Math.sin(raRad),
    z: distancePc * Math.sin(decRad)
  };
}

/**
 * Same conversion as {@link raDecDistanceToXyz}, but for sources (e.g. exoplanet host
 * stars, deep-sky catalogs) that report right ascension in degrees rather than hours.
 */
export function raDegDecDistanceToXyz(raDeg: number, decDeg: number, distancePc: number): CartesianCoordinates {
  return raDecDistanceToXyz(raDeg / HOURS_TO_DEG, decDeg, distancePc);
}

/**
 * Converts a parallax (milliarcseconds) into a distance in parsecs.
 * Returns `Infinity` for non-positive parallax (unmeasured/negative parallax).
 */
export function parallaxMasToParsecs(parallaxMas: number): number {
  return parallaxMas > 0 ? 1000 / parallaxMas : Infinity;
}

/**
 * Euclidean distance (parsecs) between two Cartesian points, e.g. for nearest-neighbour
 * star matching during exoplanet host-star cross-referencing.
 */
export function distanceBetween(a: CartesianCoordinates, b: CartesianCoordinates): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
