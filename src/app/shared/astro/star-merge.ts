import { StarRecord } from '../models/star.model';

/**
 * Merges star catalogues that overlap.
 *
 * Every all-sky survey contains the bright stars, so unioning two catalogues without matching
 * them first would draw Sirius twice — in slightly different places, since two instruments never
 * agree exactly. The merge therefore has to decide when two rows are the same object, and which
 * of them to believe.
 *
 * Identity is decided on the sky rather than in space. Two catalogues agree closely on a star's
 * *direction* — it is an angle, measured directly — and disagree much more on its *distance*,
 * which comes from a parallax with real error bars. Matching on 3D proximity would therefore
 * fail exactly where the catalogues are most useful: a star at 200 pc with a 25% distance
 * disagreement is 50 pc from itself, while its direction is identical to within an arcsecond.
 */

const DEG_TO_RAD = Math.PI / 180;

/** Angular separation, in degrees, below which two entries are taken to be the same star. */
export const MERGE_ANGULAR_TOLERANCE_DEG = 1 / 3600;

/**
 * How far two distances may disagree, as a ratio, and still describe the same star. Generous on
 * purpose: Hipparcos and Gaia routinely differ by tens of per cent at a few hundred parsecs, and
 * that disagreement is the *reason* to prefer one, not evidence they are different objects.
 */
export const MERGE_DISTANCE_RATIO_TOLERANCE = 0.5;

export interface MergeCandidate {
  readonly sourceId: string;
  /** Lower is better — the parallax precision this source measures with, in milliarcseconds. */
  readonly parallaxPrecisionMas: number;
  readonly stars: readonly StarRecord[];
}

export interface MergeSummary {
  readonly total: number;
  /** Entries dropped because a better-measured catalogue already had that star. */
  readonly duplicates: number;
  readonly bySource: Readonly<Record<string, number>>;
}

/** Unit direction of a star, which is the quantity catalogues actually agree on. */
function direction(star: StarRecord): [number, number, number] {
  const length = Math.hypot(star.x, star.y, star.z);
  return length === 0 ? [0, 0, 0] : [star.x / length, star.y / length, star.z / length];
}

function distanceOf(star: StarRecord): number {
  return Math.hypot(star.x, star.y, star.z);
}

/**
 * Buckets a direction onto a coarse sky grid, so a star only has to be compared against the
 * handful of entries near it rather than against every star already merged.
 *
 * The cell is much larger than the match tolerance, so a pair straddling a boundary would be
 * missed — which is why {@link neighbouringCells} checks the adjacent cells too.
 */
const SKY_CELL_DEG = 0.5;

function cellKey(raDeg: number, decDeg: number): string {
  return `${Math.floor(raDeg / SKY_CELL_DEG)}:${Math.floor(decDeg / SKY_CELL_DEG)}`;
}

function skyAngles(star: StarRecord): { raDeg: number; decDeg: number } {
  const [x, y, z] = direction(star);
  return { raDeg: (Math.atan2(y, x) / DEG_TO_RAD + 360) % 360, decDeg: Math.asin(Math.max(-1, Math.min(1, z))) / DEG_TO_RAD };
}

function neighbouringCells(raDeg: number, decDeg: number): string[] {
  const keys: string[] = [];
  for (let dRa = -1; dRa <= 1; dRa++) {
    for (let dDec = -1; dDec <= 1; dDec++) {
      keys.push(cellKey(raDeg + dRa * SKY_CELL_DEG, decDeg + dDec * SKY_CELL_DEG));
    }
  }
  return keys;
}

/** Cosine of the angle between two stars' directions. */
export function directionCosine(a: StarRecord, b: StarRecord): number {
  const [ax, ay, az] = direction(a);
  const [bx, by, bz] = direction(b);
  return Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
}

/** Whether two entries describe the same star: same direction, and distances not in conflict. */
export function isSameStar(a: StarRecord, b: StarRecord): boolean {
  const [near, far] = [distanceOf(a), distanceOf(b)].sort((p, q) => p - q);

  // The Sun sits at the origin of this coordinate system and so has no direction at all, which
  // the angular test below cannot speak about. Every catalogue contains it, so without this the
  // merge would happily keep one Sun per source.
  if (near === 0) {
    return far === 0;
  }

  const separationDeg = Math.acos(directionCosine(a, b)) / DEG_TO_RAD;
  if (separationDeg > MERGE_ANGULAR_TOLERANCE_DEG) {
    return false;
  }

  return (far - near) / near <= MERGE_DISTANCE_RATIO_TOLERANCE;
}

/**
 * Unions the given catalogues, keeping one entry per star.
 *
 * Sources are taken in order of how precisely they measure parallax, best first, and a star is
 * only added if no better-measured catalogue already has it. So where Gaia and Hipparcos
 * overlap, the position is Gaia's; where only Hipparcos reaches, the star is still there.
 */
export function mergeStarCatalogues(candidates: readonly MergeCandidate[]): { stars: StarRecord[]; summary: MergeSummary } {
  const ordered = [...candidates].sort((a, b) => a.parallaxPrecisionMas - b.parallaxPrecisionMas);
  const merged: StarRecord[] = [];
  const grid = new Map<string, StarRecord[]>();
  const bySource: Record<string, number> = {};
  let duplicates = 0;

  for (const candidate of ordered) {
    bySource[candidate.sourceId] = 0;

    for (const star of candidate.stars) {
      const { raDeg, decDeg } = skyAngles(star);
      const alreadyPresent = neighbouringCells(raDeg, decDeg).some((key) => (grid.get(key) ?? []).some((existing) => isSameStar(existing, star)));

      if (alreadyPresent) {
        duplicates++;
        continue;
      }

      const withSource: StarRecord = { ...star, source: star.source ?? candidate.sourceId };
      merged.push(withSource);
      bySource[candidate.sourceId]++;

      const key = cellKey(raDeg, decDeg);
      const cell = grid.get(key);
      if (cell) {
        cell.push(withSource);
      } else {
        grid.set(key, [withSource]);
      }
    }
  }

  return { stars: merged, summary: { total: merged.length, duplicates, bySource } };
}
