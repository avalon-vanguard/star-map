import { CartesianCoordinates, distanceBetween, raDegDecDistanceToXyz } from './coordinates';
import { StarRecord } from '../models/star.model';

/** Normalizes a star name for comparison: lowercase, alphanumeric characters only. */
export function normalizeStarName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface HostStarQuery {
  hostname: string;
  raDeg: number;
  decDeg: number;
  distancePc: number;
}

/** Builds a lookup of normalized star name -> star, for fast repeated name matching. */
export function buildStarNameIndex(stars: readonly StarRecord[]): Map<string, StarRecord> {
  return new Map(stars.map((star) => [normalizeStarName(star.name), star]));
}

/**
 * Cross-references an exoplanet host star to the HYG star index: first by (normalized)
 * name, then by nearest-neighbour position matching within `toleranceInPc`. Returns `null`
 * when neither approach finds a confident match, rather than guessing.
 *
 * `nameIndex` should be built once (via {@link buildStarNameIndex}) and reused across calls
 * when resolving many queries against the same star list.
 */
export function resolveHostStarId(
  query: HostStarQuery,
  stars: readonly StarRecord[],
  toleranceInPc: number,
  nameIndex: Map<string, StarRecord> = buildStarNameIndex(stars)
): number | null {
  const byName = nameIndex.get(normalizeStarName(query.hostname));
  if (byName) {
    return byName.id;
  }

  if (![query.raDeg, query.decDeg, query.distancePc].every(Number.isFinite)) {
    return null;
  }

  // A non-positive distance is never a real measurement, and it is the specific shape a
  // missing CSV cell takes: `Number('')` is `0`, which passes the finiteness check above and
  // then places the host exactly at the origin — where it matches the Sun at distance 0 and
  // hands an alien planet to our own solar system.
  if (query.distancePc <= 0) {
    return null;
  }

  const hostPosition = raDegDecDistanceToXyz(query.raDeg, query.decDeg, query.distancePc);
  return findNearestStarWithin(hostPosition, stars, toleranceInPc);
}

function findNearestStarWithin(position: CartesianCoordinates, stars: readonly StarRecord[], toleranceInPc: number): number | null {
  let closest: { id: number; distance: number } | null = null;

  for (const star of stars) {
    const distance = distanceBetween(position, star);
    if (distance <= toleranceInPc && (!closest || distance < closest.distance)) {
      closest = { id: star.id, distance };
    }
  }

  return closest ? closest.id : null;
}
