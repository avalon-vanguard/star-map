import { CartesianCoordinates, distanceBetween, raDegDecDistanceToXyz } from './coordinates';
import { ExoplanetRecord } from '../models/exoplanet.model';
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

/**
 * Re-resolves every exoplanet's host star against a star catalogue.
 *
 * The cross-reference is a *derived* fact: it depends as much on which stars were loaded as on
 * the archive itself. When the catalogue reached 50 pc, 388 of the archive's 4735 named hosts
 * found a match and the other 4347 were carried and never drawn — not because their planets are
 * unknown, but because their star was out of range. Widening the catalogue rescues some of them,
 * and until the host coordinates were stored alongside each planet that meant re-downloading an
 * archive which is not always reachable.
 *
 * Records written before those coordinates were kept can still be matched *by name*, which needs
 * no coordinates at all — and that alone is worth doing, because a wider catalogue contains more
 * names. What such a record cannot do is disprove its existing match: a name miss means only
 * that the name missed, not that the star is absent. So those are upgraded where a match is
 * found and left alone otherwise, while records that do carry coordinates take the new result
 * outright, match or no match.
 */

/** A host must sit within this many parsecs of a catalogue star to count as the same object. */
export const HOST_MATCH_TOLERANCE_PC = 2;

export interface RematchSummary {
  total: number;
  /** Records carrying host coordinates, and therefore eligible to be re-matched in full. */
  resolvable: number;
  matched: number;
  gained: number;
  lost: number;
}

export function rematchHostStars(exoplanets: ExoplanetRecord[], stars: readonly StarRecord[]): RematchSummary {
  const nameIndex = buildStarNameIndex(stars);
  const summary: RematchSummary = { total: exoplanets.length, resolvable: 0, matched: 0, gained: 0, lost: 0 };

  for (const exoplanet of exoplanets) {
    const { hostRaDeg, hostDecDeg, hostDistancePc } = exoplanet;
    const positioned = hostRaDeg !== undefined && hostDecDeg !== undefined && hostDistancePc !== undefined;
    if (positioned) {
      summary.resolvable++;
    }

    const previous = exoplanet.hostStarId;
    // With no coordinates the query still carries the host's name, and `resolveHostStarId` tries
    // that first; the positional fallback simply declines to run on non-finite coordinates.
    const resolved = resolveHostStarId(
      { hostname: exoplanet.hostStarName, raDeg: hostRaDeg ?? Number.NaN, decDeg: hostDecDeg ?? Number.NaN, distancePc: hostDistancePc ?? Number.NaN },
      stars,
      HOST_MATCH_TOLERANCE_PC,
      nameIndex
    );

    exoplanet.hostStarId = positioned ? resolved : (resolved ?? previous);
    if (exoplanet.hostStarId !== null) {
      summary.matched++;
    }
    if (previous === null && exoplanet.hostStarId !== null) {
      summary.gained++;
    } else if (previous !== null && exoplanet.hostStarId === null) {
      summary.lost++;
    }
  }

  return summary;
}
