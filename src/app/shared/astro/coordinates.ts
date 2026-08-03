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
 * Direction to a point on the celestial sphere as a unit vector, in the same equatorial frame
 * as {@link raDecDistanceToXyz}. Used for sources whose distance is unknown or irrelevant —
 * e.g. deep-sky objects rendered as a backdrop, where only the line of sight matters.
 */
export function raDecToUnitVector(raHours: number, decDeg: number): CartesianCoordinates {
  return raDecDistanceToXyz(raHours, decDeg, 1);
}

const SEXAGESIMAL_PATTERN = /^([+-])?(\d+):(\d+):(\d+(?:\.\d+)?)$/;

/**
 * Parses a sexagesimal angle ("HH:MM:SS.ss" or "+DD:MM:SS.s", as published by OpenNGC and
 * most catalogs) into a decimal value carrying the unit of its first field — hours for right
 * ascension, degrees for declination.
 *
 * The sign is read from the string rather than from the parsed degrees field: `Number('-00')`
 * is `-0`, which compares equal to `0`, so a declination like "-00:24:54.8" would otherwise
 * come out positive and place the object in the wrong hemisphere.
 *
 * Returns `null` for anything that isn't a well-formed sexagesimal triple, including the empty
 * strings that catalogs use for missing values.
 */
export function parseSexagesimal(text: string | undefined | null): number | null {
  const match = SEXAGESIMAL_PATTERN.exec((text ?? '').trim());
  if (!match) {
    return null;
  }

  const [, sign, degreesOrHours, minutes, seconds] = match;
  const magnitude = Number(degreesOrHours) + Number(minutes) / 60 + Number(seconds) / 3600;
  return sign === '-' ? -magnitude : magnitude;
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
