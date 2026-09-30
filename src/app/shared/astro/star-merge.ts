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
 * Angular separation, in degrees, under which the distances are not consulted. A coincidence of
 * direction this close is never chance at this depth — the quarter-degree shift finds none under
 * 3″ — so two entries this close are one star whatever their parallaxes say, and what they say
 * is often a Hipparcos parallax off by half: 1 500 stars sat within this of their Gaia entry and
 * were kept twice by the distance test, thirty of them at a false few parsecs from the Sun
 * (HIP 82724 at 3.7 pc, where Gaia has it at 62.8). Brightness keeps its say at any separation,
 * because a companion can sit this close: Ashlesha's is 2.7″ away and three magnitudes fainter.
 */
export const MERGE_CERTAIN_ANGULAR_TOLERANCE_DEG = 3 / 3600;

/**
 * Angular separation, in degrees, within which two entries that cross the sky together are one
 * star, and how closely their proper motions must agree (as a fraction of the kept entry's) to
 * say so. Past fifteen arcseconds, and past a distance conflict, a Gliese-only entry is still
 * often the same star: its position is off by up to a minute of arc and its distance is
 * photometric — GJ 1035 sits 21″ from its Gaia entry, GJ 3052 at half Gaia's distance. What
 * gives them away is their motion, which Gliese measured well: a few per cent from Gaia's.
 *
 * Once the nearby faint Gaia stars joined, 253 of the 602 Gliese-only stars left without a
 * counterpart had a Gaia entry within a minute of arc moving within a fifth of their own motion;
 * shifted a quarter of a degree, none did. A minute was not enough, though: 39 Gliese stars within
 * 25 pc still had a bare Gaia entry moving with them 60 to 150″ away, 36 of which SIMBAD names as
 * the same star — GJ 3618, LHS 288, drawn at 4.49 pc and again 94″ away at 4.83 — while shifted a
 * quarter of a degree, none did. So 160″. Brightness still has its say, so a co-moving companion
 * is not folded into its primary, and `fetchStars` gives HYG's motions only to those rows.
 */
export const MERGE_COMOVING_ANGULAR_TOLERANCE_DEG = 160 / 3600;
export const MERGE_PROPER_MOTION_TOLERANCE = 0.2;

/**
 * How much fainter, and how much brighter, an entry may be than the one it is folded into and
 * still be the same star. Bands differ, and not symmetrically: a red dwarf is three magnitudes
 * fainter in HYG's V than in Gaia's G, so the folded entry may be up to five fainter. A star is
 * never much brighter in V than in G, though, and an entry a magnitude brighter than what is
 * already at that spot is a primary Gaia does not carry — it saturates below G ≈ 3 — sitting
 * beside its companion: Sirius 6″ from Sirius B and ten magnitudes brighter, Almach 10″ from
 * γ² And, Alfirk 13″ from β Cep B. Without this the primary's name lands on the companion's
 * entry, and the companion is gone.
 */
export const MERGE_FAINTER_TOLERANCE = 5;
export const MERGE_BRIGHTER_TOLERANCE = 1;

/**
 * How far two distances may disagree, as a ratio, and still describe the same star. Generous on
 * purpose: Hipparcos and Gaia routinely differ by tens of per cent at a few hundred parsecs, and
 * that disagreement is the *reason* to prefer one, not evidence they are different objects.
 */
export const MERGE_DISTANCE_RATIO_TOLERANCE = 0.5;

/** HYG's distance for a star whose parallax it does not give one for. */
export const HYG_UNKNOWN_DISTANCE_PC = 100000;

/** How many times its error a parallax HYG leaves out must be to place a star by: a 40 % error. */
const MIN_HIPPARCOS_PARALLAX_OVER_ERROR = 2.5;

/**
 * A HYG star's Hipparcos distance: HYG's own, which is the inverse of van Leeuwen's 2007 parallax,
 * or where HYG gives its placeholder instead, that inverse if the parallax is at least 2.5 times its
 * error. HYG gives no distance under 1 mas whatever the error, while keeping less certain parallaxes
 * above it: 41 naked-eye stars were left off the map as having no distance, HD 74180 at
 * 0.67 ± 0.16 mas and Mu Cep at 0.55 ± 0.20 among them, while Alnilam at 1.65 ± 0.45 was drawn.
 */
export function hipparcosDistancePc(hygPc: number, parallax?: { parallaxMas: number; relativeError: number }): number | undefined {
  if (Number.isFinite(hygPc) && hygPc > 0 && hygPc < HYG_UNKNOWN_DISTANCE_PC) {
    return hygPc;
  }
  return parallax && parallax.relativeError <= 1 / MIN_HIPPARCOS_PARALLAX_OVER_ERROR ? 1000 / parallax.parallaxMas : undefined;
}

/** The faintest star, in V, the naked eye sees under a dark sky: the traditional limit of 6.5. */
export const NAKED_EYE_MAGNITUDE = 6.5;

/**
 * Where to draw a star Hipparcos and Gaia both measured, and whether the map keeps it at all.
 *
 * At whichever distance has the smaller relative error, given both; Gaia's without them, or
 * Hipparcos's where Gaia has none. Gaia's parallaxes are some fifty times more precise, and its
 * distance wins for all but 273 of the 88 781 HYG stars with both; those are bright stars Gaia
 * saturates on, 257 of them naked-eye — Eta Leo is 556.6 pc ±17 % in Gaia and 389 pc ±6.2 % in
 * Hipparcos, Schedar ±3.5 % against ±1.0 %. The two catalogues used to be cut at the same radius, each on
 * its own distance, so a star Hipparcos put at 200 pc and Gaia at 300 was kept by one, never
 * downloaded from the other, and drawn at 200. That was 83% of the HYG stars left without a
 * Gaia counterpart, and at the median Hipparcos had them at two-thirds of Gaia's distance.
 *
 * Now a star either survey places inside `cutoffPc` is kept, and every kept star sits where the
 * better measurement puts it, inside the cutoff or not. So is every star the naked eye sees, at
 * any distance: the cutoff took 1 543 of HYG's 8 920 stars of V 6.5 or brighter, Rigel, Deneb
 * and Alnilam among them, while 11th-magnitude Gaia stars at the same distance were drawn. Those
 * Gaia has no usable parallax for sit at their Hipparcos distance. `null` for a star kept by
 * neither rule, or that no survey gives a distance for.
 */
export function placementDistancePc(
  hipparcosPc: number | undefined,
  gaiaPc: number | undefined,
  magnitude: number,
  cutoffPc: number,
  hipparcosError?: number,
  gaiaError?: number
): number | null {
  const hipparcosBetter = hipparcosPc !== undefined && hipparcosError !== undefined && gaiaError !== undefined && hipparcosError < gaiaError;
  const best = hipparcosBetter ? hipparcosPc : (gaiaPc ?? hipparcosPc);
  if (best === undefined) {
    return null;
  }
  const inside = magnitude <= NAKED_EYE_MAGNITUDE || best <= cutoffPc || (hipparcosPc !== undefined && hipparcosPc <= cutoffPc);
  return inside ? best : null;
}

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

const RA_CELLS = 360 / SKY_CELL_DEG;

function cellKey(raDeg: number, decDeg: number): string {
  // Right ascension wraps: the cell after 359.5° is 0°, so a pair straddling 0h shares a
  // neighbourhood rather than sitting 719 cells apart.
  const raCell = ((Math.floor(raDeg / SKY_CELL_DEG) % RA_CELLS) + RA_CELLS) % RA_CELLS;
  return `${raCell}:${Math.floor(decDeg / SKY_CELL_DEG)}`;
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

/** Whether both entries have a proper motion and `entry`'s is within tolerance of `kept`'s. */
function movesWith(kept: StarRecord, entry: StarRecord): boolean {
  if (kept.pmRaMasYr === undefined || kept.pmDecMasYr === undefined || entry.pmRaMasYr === undefined || entry.pmDecMasYr === undefined) {
    return false;
  }
  const difference = Math.hypot(entry.pmRaMasYr - kept.pmRaMasYr, entry.pmDecMasYr - kept.pmDecMasYr);
  return difference < MERGE_PROPER_MOTION_TOLERANCE * Math.hypot(kept.pmRaMasYr, kept.pmDecMasYr);
}

/**
 * Whether `entry` describes the star already `kept`: the same direction, the brightness not in
 * conflict and — unless the directions agree closely enough to settle it, or the two move
 * together — the distance not in conflict either.
 */
export function isSameStar(kept: StarRecord, entry: StarRecord): boolean {
  const [near, far] = [distanceOf(kept), distanceOf(entry)].sort((p, q) => p - q);

  // The Sun sits at the origin of this coordinate system and so has no direction at all, which
  // the angular test below cannot speak about. Every catalogue contains it, so without this the
  // merge would happily keep one Sun per source.
  if (near === 0) {
    return far === 0;
  }

  const separationDeg = Math.acos(directionCosine(kept, entry)) / DEG_TO_RAD;
  const comoving = movesWith(kept, entry);
  if (separationDeg > (comoving ? MERGE_COMOVING_ANGULAR_TOLERANCE_DEG : MERGE_ANGULAR_TOLERANCE_DEG)) {
    return false;
  }
  const fainterBy = entry.magnitude - kept.magnitude;
  if (fainterBy < -MERGE_BRIGHTER_TOLERANCE || fainterBy > MERGE_FAINTER_TOLERANCE) {
    return false;
  }

  if (comoving || separationDeg <= MERGE_CERTAIN_ANGULAR_TOLERANCE_DEG) {
    return true;
  }

  return (far - near) / near <= MERGE_DISTANCE_RATIO_TOLERANCE;
}

/**
 * One entry from two of the same star: the position of the better-measured one — inserted first,
 * so it is the one already `kept` — and the description of whichever knows the star as more than
 * a catalogue number. HYG's "Proxima Centauri", "M5Ve" and V magnitude over Gaia's
 * "Gaia DR3 5853498713190525696", "Unknown" and G; keeping either row whole loses half of that,
 * and keeping Gaia's whole once cost the map 102 proper names and 32 000 spectral types. The id
 * travels with the description, so a star HYG knows keeps its HYG id from one refresh to the next,
 * and so does its photometry, V and B−V. `source` stays with the position, since that is what it
 * records, and so does the distance's error: Gaia's, not the Hipparcos one of a distance dropped —
 * unless the other entry's distance is the more precise, as the Hipparcos one of a bright star
 * `placementDistancePc` keeps at it is, which then sets the distance along Gaia's direction.
 * `described` overrides that choice where an identity settles it (see {@link foldByIdentity}).
 */
function combine(kept: StarRecord, other: StarRecord, described = isDesignation(kept) && !isDesignation(other) ? other : kept): StarRecord {
  const otherBetter = other.distanceError !== undefined && kept.distanceError !== undefined && other.distanceError < kept.distanceError;
  const placed = otherBetter ? other : kept;
  const scale = otherBetter ? distanceOf(other) / distanceOf(kept) : 1;
  const gaiaDesignation = kept.gaiaDesignation ?? other.gaiaDesignation;
  return {
    ...described,
    x: kept.x * scale,
    y: kept.y * scale,
    z: kept.z * scale,
    source: kept.source,
    distanceError: placed.distanceError,
    distanceFromGaia: placed.distanceFromGaia,
    ...(gaiaDesignation === undefined ? {} : { gaiaDesignation })
  };
}

/**
 * How far apart in V a Gliese-only entry and the HYG star already on its Gaia entry may be and still
 * be one star. Of the 14 such folds, 11 agree within 0.12 (Gl 251 and HD 265866, 10.01 and 9.89);
 * Gl 905.2B, Gl 225.2C and 69 Tau Oph differ by 0.21, 0.45 and 0.47, and on all three SIMBAD puts
 * the HYG star already there on another source (see {@link foldByIdentity}). A companion SIMBAD gives
 * its primary's source differs by magnitudes.
 */
export const IDENTITY_FOLD_MAGNITUDE_TOLERANCE = 0.5;

/**
 * Whether a Gliese-only entry folds into `target`, the Gaia entry of the source SIMBAD names it as:
 * always where that entry is still bare, a Gaia designation with Gaia's G, which SIMBAD's identity
 * settles whatever HYG's V says; where a HYG star already describes it, only if the two V agree.
 */
export function foldsInto(target: StarRecord, entry: StarRecord): boolean {
  return isDesignation(target) || Math.abs(target.magnitude - entry.magnitude) <= IDENTITY_FOLD_MAGNITUDE_TOLERANCE;
}

/**
 * Folds each Gliese-only entry — HYG's, with no Hipparcos astrometry and so no published error on
 * its distance — into the Gaia entry of the source SIMBAD names it as, `gaiaDesignationById` by
 * HYG id (see {@link foldsInto}). {@link isSameStar} cannot see these: 43 of them within 25 pc stayed
 * beside their own bare Gaia entry, too far for their positions (GJ 3478, 16″), moving differently
 * by HYG's motions (GJ 2097, 39 %), or brighter in HYG's V than Gaia's G by more than a primary may
 * be (GJ 4285, 1.6 magnitudes). Two of those were stars that do not exist inside 10 pc: GJ 2097 at
 * 6.41 pc and GJ 4285 at 6.80, which Gaia measures at 24.47 and 28.25. Others sat beside a Gaia entry
 * a Hipparcos row of HYG's had already taken, HYG listing the star twice: Gl 251 at 5.76 pc beside
 * HD 265866, the host of GJ 251 b and c, at 5.58.
 *
 * The fold keeps the entry already there's photometry along with Gaia's position and distance, and
 * HYG's name and type. Taking the Gliese row's, as {@link combine} would, put CNS3's V at Gaia's
 * distance: GJ 4285 at V 11.45, where its G 13.05 and BP−RP 2.74 give 14.4, drawn five times too
 * luminous, and six stars with no colour lost their temperature and radius, Gl 700.1C among them.
 *
 * Unless SIMBAD names the HYG star already there as another source: then HYG hung it on the wrong
 * one, and the Gliese row is the star that source is, so its description — photometry included —
 * replaces that one. HIP 117059 is LAWD 93, the white dwarf Gl 905.2B (DA, V 12.94 in SIMBAD), which
 * HYG labels "Gl 905.2A", M5, V 13.11, B−V 1.55: kept, the white dwarf was drawn as a 3 384 K red
 * dwarf 15 times its radius. Five of the 63 folds are of this kind, GJ 9490C, Gl 225.2C, 69 Tau Oph
 * A and HD 65277 (Gl 293.1A) the others; each HYG star SIMBAD puts elsewhere loses its entry,
 * having no source of its own on the map to carry it.
 */
export function foldByIdentity(stars: readonly StarRecord[], gaiaDesignationById: ReadonlyMap<number, string>): { stars: StarRecord[]; folded: number } {
  const byDesignation = new Map<string, number>();
  stars.forEach((star, index) => {
    if (star.gaiaDesignation !== undefined) {
      byDesignation.set(star.gaiaDesignation, index);
    }
  });
  const result = [...stars];
  const folded = new Set<number>();
  stars.forEach((star, index) => {
    const designation = star.source === 'hyg' && star.distanceError === undefined ? gaiaDesignationById.get(star.id) : undefined;
    const target = designation === undefined ? undefined : byDesignation.get(designation);
    if (target === undefined || !foldsInto(result[target], star)) {
      return;
    }
    const describer = gaiaDesignationById.get(result[target].id);
    const { magnitude, magnitudeBand, colorIndex, colorSystem } = result[target];
    result[target] =
      describer !== undefined && describer !== designation
        ? combine(result[target], star, star)
        : { ...combine(result[target], star), magnitude, magnitudeBand, colorIndex, colorSystem };
    // One star each: a second Gliese row naming the same source is another star SIMBAD has not split.
    byDesignation.delete(designation!);
    folded.add(index);
  });
  return { stars: result.filter((_, index) => !folded.has(index)), folded: folded.size };
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
