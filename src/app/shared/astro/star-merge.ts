import { isDesignation } from '../models/star-catalog';
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

/**
 * Angular separation, in degrees, below which two entries are taken to be the same star.
 *
 * Every source arrives here at epoch J2000.0 — HYG publishes it, Gaia is carried back to it with
 * its own proper motions in `gaia.ts` — so what separates two entries of one star is measurement,
 * not motion. Left at their own epochs, sixteen years of proper motion put Proxima's two entries
 * 62″ apart and Barnard's 166″, and an arcsecond of tolerance kept every fast star twice while
 * folding the slow ones.
 *
 * What measurement leaves is under an arcsecond for a Hipparcos position — 55 457 of the 56 000
 * stars both catalogues hold — and up to tens of arcseconds for the Gliese-only entries HYG
 * carries without Hipparcos astrometry: Wolf 359 sits 5″ from where Gaia has it, Ross 248 12″.
 * Fifteen arcseconds takes those. The sky is sparse enough at this depth that shifting every
 * entry a quarter of a degree finds only 16 chance neighbours within it, against 116 real ones
 * between ten and fifteen; past twenty the two curves run together.
 */
export const MERGE_ANGULAR_TOLERANCE_DEG = 15 / 3600;

/**
 * How far two catalogues may disagree about a star's brightness and still describe the same
 * star. Bands differ — HYG's V and Gaia's G are three magnitudes apart for the reddest dwarfs —
 * but five is not a band, it is a companion: Sirius B sits 6″ from Sirius and ten magnitudes
 * fainter, Polaris B 18″ and seven. Gaia saturates below G ≈ 3, so without this a bright primary
 * it does not carry is folded into its companion's entry, and the companion is gone.
 */
export const MERGE_MAGNITUDE_TOLERANCE = 5;

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
  /** Entries folded into one a better-measured catalogue already had; see {@link combine}. */
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

/**
 * Whether two entries describe the same star: same direction, and neither distance nor
 * brightness in conflict.
 */
export function isSameStar(a: StarRecord, b: StarRecord): boolean {
  if (Math.abs(a.magnitude - b.magnitude) > MERGE_MAGNITUDE_TOLERANCE) {
    return false;
  }

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
 * One entry from two of the same star: the position of the better-measured one — inserted first,
 * so it is the one already `kept` — and the description of whichever knows the star as more than
 * a catalogue number. HYG's "Proxima Centauri", "M5Ve" and V magnitude over Gaia's
 * "Gaia DR3 5853498713190525696", "Unknown" and G; keeping either row whole loses half of that,
 * and keeping Gaia's whole once cost the map 102 proper names and 32 000 spectral types. The id
 * travels with the description, so a star HYG knows keeps its HYG id from one refresh to the next;
 * `source` stays with the position, since that is what it records.
 */
function combine(kept: StarRecord, other: StarRecord): StarRecord {
  const described = isDesignation(kept) && !isDesignation(other) ? other : kept;
  return { ...described, x: kept.x, y: kept.y, z: kept.z, source: kept.source };
}

/**
 * Unions the given catalogues, keeping one entry per star.
 *
 * Sources are taken in order of how precisely they measure parallax, best first. An entry that a
 * better-measured catalogue already has is folded into that entry — the nearest one within the
 * tolerance, see {@link combine} for what each side keeps. Only entries from *other* sources
 * count as already there: a catalogue does not list a star twice, so two of its own entries
 * within the tolerance are two stars, typically a double that Gaia resolves and Hipparcos did
 * not. Where only one source reaches, the star is still there.
 */
export function mergeStarCatalogues(candidates: readonly MergeCandidate[]): { stars: StarRecord[]; summary: MergeSummary } {
  const ordered = [...candidates].sort((a, b) => a.parallaxPrecisionMas - b.parallaxPrecisionMas);
  const merged: StarRecord[] = [];
  const grid = new Map<string, number[]>();
  // Entries that already absorbed one from a source, as `${index}/${source}`: a double that
  // Gliese lists as two entries at one position has to land on two Gaia entries, not on one.
  const taken = new Set<string>();
  const bySource: Record<string, number> = {};
  let duplicates = 0;

  for (const candidate of ordered) {
    bySource[candidate.sourceId] = 0;

    for (const star of candidate.stars) {
      const entry: StarRecord = { ...star, source: star.source ?? candidate.sourceId };
      const { raDeg, decDeg } = skyAngles(entry);

      let match: number | null = null;
      let matchCosine = -1;
      for (const key of neighbouringCells(raDeg, decDeg)) {
        for (const index of grid.get(key) ?? []) {
          const existing = merged[index];
          if (existing.source === entry.source || taken.has(`${index}/${entry.source}`) || !isSameStar(existing, entry)) {
            continue;
          }
          const cosine = directionCosine(existing, entry);
          if (cosine > matchCosine) {
            match = index;
            matchCosine = cosine;
          }
        }
      }

      if (match !== null) {
        merged[match] = combine(merged[match], entry);
        taken.add(`${match}/${entry.source}`);
        duplicates++;
        continue;
      }

      const index = merged.push(entry) - 1;
      bySource[candidate.sourceId]++;

      const key = cellKey(raDeg, decDeg);
      const cell = grid.get(key);
      if (cell) {
        cell.push(index);
      } else {
        grid.set(key, [index]);
      }
    }
  }

  return { stars: merged, summary: { total: merged.length, duplicates, bySource } };
}
