import { propagateProperMotion, raDegDecDistanceToXyz } from './coordinates';
import { MERGE_DISTANCE_RATIO_TOLERANCE } from './star-merge';
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
  /** μα·cos δ in mas/yr, as the archive publishes it (`sy_pmra`); missing means unknown. */
  pmRaMasPerYear?: number;
  pmDecMasPerYear?: number;
}

/**
 * Builds a lookup of normalized star name -> star, for fast repeated name matching.
 *
 * A name two stars answer to names neither: normalizing strips the dot, so `Gl 55.2` and
 * `Gl 552` — 135° apart, and 64 such groups exist in the catalogue — collide on `gl552`, and a
 * map would silently keep whichever came last. Ambiguous keys are dropped instead, which sends
 * the query to the sky, where direction settles it.
 */
export function buildStarNameIndex(stars: readonly StarRecord[]): Map<string, StarRecord> {
  const index = new Map<string, StarRecord>();
  const ambiguous = new Set<string>();
  for (const star of stars) {
    const key = normalizeStarName(star.name);
    if (index.has(key)) {
      ambiguous.add(key);
    } else {
      index.set(key, star);
    }
  }
  for (const key of ambiguous) {
    index.delete(key);
  }
  return index;
}

/**
 * How far, on the sky, a host may sit from a catalogue star and still be the same object —
 * expressed as a transverse offset in parsecs (separation angle × the host's distance), not as
 * an angle.
 *
 * The offset between the archive's position and ours is dominated by proper motion over an
 * epoch difference, and that is a *physical* displacement: velocity × time, the same in parsecs
 * at any distance. As an angle it is anything — Proxima's two positions are 60″ apart, a host at
 * 100 pc moves under 2″ — so a fixed angle either loses the near, fast stars or drowns the far
 * ones in neighbours. In parsecs the bound is one number: 25 years of an extreme 200 km/s
 * transverse velocity is 5·10⁻³ pc.
 *
 * Measured on the 504 hosts whose archive name matches a catalogue name outright — true pairs,
 * matched without coordinates: their transverse offset reaches 3.4·10⁻³ pc (5.0·10⁻³ before the
 * epoch straddle below) and 0.01 pc doubles that. Chance stays out of reach: shifting every
 * host a quarter of a degree finds nothing within the budget except Proxima's own entry, whose
 * budget at 1.3 pc is wider than the shift itself.
 */
export const HOST_TRANSVERSE_TOLERANCE_PC = 0.01;

/**
 * The archive does not say which epoch a row's position is for, and they are demonstrably
 * mixed: alf Tau and GJ 273 publish J2000 (the raw position sits under an arcsecond from our
 * star, and carrying it back doubles the error), HD 133131 and TOI-2459 publish Gaia's J2016
 * (the carried-back position lands to 0.1″). So every query is tried at both ends — as
 * published, and carried back sixteen years with the archive's own proper motion — and a star
 * is judged on whichever is closer. Guessing one epoch picks companions: assume J2016 and
 * Aldebaran's planet lands on Gl 171.1B, assume J2000 and GJ 15 A's land on a Gaia entry
 * 15.9″ out.
 */
const CATALOGUE_EPOCH = 2000.0;
const ARCHIVE_LATEST_EPOCH = 2016.0;

function knownMotion(masPerYear: number | undefined): number {
  return Number.isFinite(masPerYear) ? (masPerYear as number) : 0;
}

/**
 * Cross-references an exoplanet host star to the star catalogue: first by (normalized) name,
 * then on the sky — the nearest star within {@link HOST_TRANSVERSE_TOLERANCE_PC} whose distance
 * does not flatly contradict the archive's ({@link MERGE_DISTANCE_RATIO_TOLERANCE}, shared with
 * the catalogue merge, which faces the same Hipparcos-vs-Gaia disagreements). Returns `null`
 * when neither approach finds a confident match, rather than guessing.
 *
 * Identity lives in the direction, exactly as in `star-merge.ts`: the previous rule — nearest
 * neighbour within half a parsec in 3D — turned into a ten-arcminute cone at 170 pc, handing
 * planets of stars our catalogue does not contain to whatever bright star floated nearest
 * (HATS-6 to HD 39500), while a 1 pc distance disagreement at 60 pc unhosted four bright
 * giants' planets whose directions matched to two arcseconds.
 *
 * `nameIndex` should be built once (via {@link buildStarNameIndex}) and reused across calls
 * when resolving many queries against the same star list.
 */
export function resolveHostStarId(
  query: HostStarQuery,
  stars: readonly StarRecord[],
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
  // missing CSV cell takes: `Number('')` is `0`. Without a believable distance there is no
  // transverse budget and no ratio test, so the position cannot speak.
  if (query.distancePc <= 0) {
    return null;
  }

  const published = raDegDecDistanceToXyz(query.raDeg, query.decDeg, 1);
  const carriedBack = propagateProperMotion(
    query.raDeg,
    query.decDeg,
    // A proper motion that is not a number must read as "stands still", not poison the
    // comparison: one NaN makes every star's cosine NaN, and `NaN < min` is false, so every
    // star would pass the direction test and the last one in array order would win.
    knownMotion(query.pmRaMasPerYear),
    knownMotion(query.pmDecMasPerYear),
    CATALOGUE_EPOCH - ARCHIVE_LATEST_EPOCH
  );
  const carried = raDegDecDistanceToXyz(carriedBack.raDeg, carriedBack.decDeg, 1);

  const minCosine = Math.cos(Math.min(Math.PI, HOST_TRANSVERSE_TOLERANCE_PC / query.distancePc));
  let best: StarRecord | null = null;
  let bestCosine = -2;
  for (const star of stars) {
    const starDistance = Math.hypot(star.x, star.y, star.z);
    // The Sun sits at the origin and has no direction to compare; every real host is elsewhere.
    if (starDistance === 0) {
      continue;
    }
    const cosine =
      Math.max(
        star.x * published.x + star.y * published.y + star.z * published.z,
        star.x * carried.x + star.y * carried.y + star.z * carried.z
      ) / starDistance;
    if (cosine < minCosine || cosine <= bestCosine) {
      continue;
    }
    const [near, far] = query.distancePc < starDistance ? [query.distancePc, starDistance] : [starDistance, query.distancePc];
    if ((far - near) / near > MERGE_DISTANCE_RATIO_TOLERANCE) {
      continue;
    }
    best = star;
    bestCosine = cosine;
  }

  return best ? best.id : null;
}
