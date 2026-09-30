import { writeFileSync } from 'node:fs';

import { foldByIdentity, hipparcosDistancePc, HYG_UNKNOWN_DISTANCE_PC, mergeStarCatalogues, NAKED_EYE_MAGNITUDE, placementDistancePc } from '../../src/app/shared/astro/star-merge';
import { encodeStarCatalog } from '../../src/app/shared/models/star-catalog';
import { StarRecord, SUN_STAR_ID } from '../../src/app/shared/models/star.model';
import { BrightGaiaSource, fetchBrightGaiaSources, fetchGaiaDistancesByHip, fetchHipparcosParallaxErrors, GaiaAnswerError } from './sources/gaia';
import { positionalSources } from './sources/registry';
import { fetchGaiaDesignationsByGj, fetchGaiaDesignationsByHd } from './sources/simbad';
import { PARALLAX_PRECISION_MAS } from './sources/star-sources';
import { parseCsvObjects, parseOptionalNumber } from './lib/csv';
import { fetchTextCached } from './lib/http';
import { dataPath, ensureDataDir } from './lib/paths';

const HYG_CSV_URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';

/**
 * Stand-in magnitude for a star with no photometry. Faint rather than 0, because 0 would mean
 * "as bright as Vega" and render it as one of the largest points on the map.
 */
const UNKNOWN_MAGNITUDE = 15;

/**
 * Stars either survey places within this distance (parsecs) of the Sun are kept for the galaxy
 * view, and every naked-eye star wherever it is; `placementDistancePc` decides which distance a
 * kept star is drawn at.
 *
 * Set at the range Hipparcos's own measurements reach rather than at a round number: its
 * parallaxes are good to roughly a milliarcsecond, so at 250 pc (4 mas) a distance is uncertain
 * by some tens of per cent. That is why it is not applied to the Hipparcos distance alone:
 * Gaia puts 6 833 of the stars Hipparcos places inside it outside, and 3 666 the other way
 * round. Only the *radial* placement blurs; a star's direction on the sky stays exact.
 *
 * The catalogue is also magnitude-limited, so this is not a volume-complete sample beyond about
 * 50 pc: it thins to the intrinsically bright, which is the same selection the naked eye makes.
 */
const DISTANCE_CUTOFF_PC = Number(process.env['ETL_STAR_DISTANCE_PC'] ?? 250);

function resolveName(row: Record<string, string>): string {
  if (row['proper']) {
    return row['proper'];
  }
  if (row['bayer'] && row['con']) {
    return `${row['bayer']} ${row['con']}`;
  }
  if (row['flam'] && row['con']) {
    return `${row['flam']} ${row['con']}`;
  }
  if (row['hd']) {
    return `HD ${row['hd']}`;
  }
  if (row['gl']) {
    // Already a complete designation ("Gl 581", "GJ 3512"), unlike the bare numbers in `hd`
    // and `hip` — prefixing it again produced 2331 stars named "Gl GJ 1076", which broke
    // search, the on-screen labels, and exoplanet host-star name matching alike.
    return row['gl'];
  }
  if (row['hip']) {
    return `HIP ${row['hip']}`;
  }
  return `HYG ${row['id']}`;
}

/**
 * HYG's spectral type, without the `...` that 2 127 of the map's stars end in, all of them
 * Hipparcos stars: the Hipparcos catalogue's mark for a classification it does not print in full
 * (Sirius is "A0m..."). On the map it read as text the app had cut short.
 */
function spectralTypeOf(row: Record<string, string>): string {
  return (row['spect'] ?? '').replace(/\.\.\.$/, '') || 'Unknown';
}

/**
 * Downloads the HYG (Hipparcos/Yale/Gliese) stellar database, places each star along its
 * equatorial direction (epoch J2000.0) at whichever of its Hipparcos and Gaia distances has the
 * smaller error, keeps the ones either survey puts within range, and unions the other positional
 * sources. Writes nothing: fetchExoplanets adds the hosts the catalogue lacks and renames the
 * ones known only by a designation, then writes the star assets once. Written here as well, they
 * stood on disk without those 3 277 stars whenever a run stopped between the two — and that
 * catalogue left 4 237 planets pointing at stars it did not have.
 */
export async function fetchStars(): Promise<StarRecord[]> {
  console.log(`Fetching HYG star catalog (distance cutoff: ${DISTANCE_CUTOFF_PC} pc)...`);
  const csv = await fetchTextCached(HYG_CSV_URL, 'hygdata_v41.csv');
  const rows = parseCsvObjects(csv);
  // Not skipped when unreachable, unlike the positional sources below; see its own comment.
  const gaiaByHip = await fetchGaiaDistancesByHip();
  const hipparcosErrors = await fetchHipparcosParallaxErrors();
  const brightGaia = await fetchBrightGaiaSources();
  const brightByDesignation = new Map(brightGaia.map((source) => [source.designation, source]));
  const nakedEyeDesignations = await fetchGaiaDesignationsByHd(
    rows.filter((row) => row['hd'] && Number(row['dist']) >= HYG_UNKNOWN_DISTANCE_PC && (parseOptionalNumber(row['mag']) ?? Infinity) <= NAKED_EYE_MAGNITUDE).map((row) => row['hd'])
  );

  const stars: StarRecord[] = [];
  let atGaiaDistance = 0;
  let pastCutoff = 0;
  let identified = 0;

  for (const row of rows) {
    const id = Number(row['id']);

    if (id === SUN_STAR_ID) {
      stars.push({ id, name: 'Sol', x: 0, y: 0, z: 0, magnitude: parseOptionalNumber(row['mag']) ?? UNKNOWN_MAGNITUDE, magnitudeBand: 'V', spectralType: row['spect'] || 'G2V', colorIndex: parseOptionalNumber(row['ci']) ?? null, colorSystem: 'B-V' });
      continue;
    }

    const hygPc = Number(row['dist']);
    const hipparcos = row['hip'] ? hipparcosErrors.get(Number(row['hip'])) : undefined;
    const hipparcosPc = hipparcosDistancePc(hygPc, hipparcos);
    const magnitudeV = parseOptionalNumber(row['mag']);
    const magnitude = magnitudeV ?? UNKNOWN_MAGNITUDE;
    const unplaced = hipparcosPc === undefined && magnitude <= NAKED_EYE_MAGNITUDE;
    const crossMatched = row['hip'] ? gaiaByHip.get(Number(row['hip'])) : undefined;
    const positional = crossMatched === undefined && unplaced ? brightCounterpart(row, magnitude, brightGaia) : undefined;
    // Where HYG's position leads to no bright source, the one SIMBAD names it as: HD 45951, whose
    // declination HYG has 31.7′ out. Within a magnitude of HYG's V, as by position: θ¹ Ori A
    // (HD 37020) has V 4.98 and O7 in HYG, Hipparcos's entry for it and a companion together, and
    // its own source G 6.63 (SIMBAD: V 6.73, B0V). Placed, it was drawn brighter than θ¹ Ori C and
    // counted as naked-eye; at 378 pc and its own magnitude the map does not keep it.
    const named = crossMatched === undefined && positional === undefined && unplaced ? brightByDesignation.get(nakedEyeDesignations.get(`HD ${row['hd']}`) ?? '') : undefined;
    const byIdentity = named && Math.abs(named.magnitudeG - magnitude) <= BRIGHT_COUNTERPART_MAGNITUDES ? named : undefined;
    const gaia = crossMatched ?? positional ?? byIdentity;
    const gaiaPc = gaia?.distancePc;
    const hipparcosError = hipparcos?.relativeError;
    const distancePc = placementDistancePc(hipparcosPc, gaiaPc, magnitude, DISTANCE_CUTOFF_PC, hipparcosError, gaia?.relativeError);
    if (distancePc === null) {
      continue;
    }
    const fromGaia = gaia !== undefined && distancePc === gaiaPc;

    // HYG's own Cartesian columns rather than its `ra`/`dec`, which are in the same frame as
    // `raDecDistanceToXyz` and would be redundant if the two agreed. They do not, for the stars
    // that move: the right ascension was carried from the Hipparcos epoch to 2000.0 without the
    // cos δ its motion needs, which puts Proxima 17.9″ from where HYG's own x/y/z — and Gaia,
    // once brought to the same epoch — have it. 1813 stars differ by over an arcsecond, and the
    // Cartesian columns are the ones Gaia agrees with for 1155 of them against 156 (one of those,
    // HIP 57146, has x/y/z 161″ from its own ra/dec and stays double).
    //
    // Only their direction is used. They sit at HYG's own distance, or at its 100 000 pc
    // placeholder where it has none, and are carried along that direction to the one chosen above —
    // Gaia's, for a star found by its identity, where HYG's may be the thing that is wrong.
    const [x, y, z] = byIdentity ? [byIdentity.direction.x, byIdentity.direction.y, byIdentity.direction.z] : [Number(row['x']), Number(row['y']), Number(row['z'])];
    const length = Math.hypot(x, y, z);
    if (![x, y, z].every(Number.isFinite) || length === 0) {
      continue;
    }
    const scale = distancePc / length;
    if (fromGaia) {
      atGaiaDistance++;
    }
    if (byIdentity) {
      identified++;
    }
    if (distancePc > DISTANCE_CUTOFF_PC) {
      pastCutoff++;
    }

    // Gaia's error with Gaia's distance, Hipparcos's with its own; a Gliese row, with neither, has
    // no published error, and its distance is as often photometric as measured.
    const distanceError = fromGaia ? gaia.relativeError : hipparcosError;
    const colorIndex = parseOptionalNumber(row['ci']);

    stars.push({
      id,
      name: resolveName(row),
      x: x * scale,
      y: y * scale,
      z: z * scale,
      magnitude,
      ...(magnitudeV === undefined ? {} : { magnitudeBand: 'V' as const }),
      spectralType: spectralTypeOf(row),
      colorIndex: colorIndex ?? null,
      ...(colorIndex === undefined ? {} : { colorSystem: 'B-V' as const }),
      ...(distanceError === undefined ? {} : { distanceError }),
      distanceFromGaia: fromGaia,
      // Only for the Gliese-only rows, whose positions are what the merge needs the motion to see
      // past. A Hipparcos position is good to under an arcsecond; given its motion too, 15 stars
      // took their co-moving companion's Gaia entry, and the companion was kept twice.
      ...(row['hip'] ? {} : { pmRaMasYr: parseOptionalNumber(row['pmra']), pmDecMasYr: parseOptionalNumber(row['pmdec']) })
    });
  }

  console.log(
    `  kept ${stars.length} stars (of ${rows.length} in the catalog): ${atGaiaDistance} at Gaia's distance, ${pastCutoff} of them past ${DISTANCE_CUTOFF_PC} pc; ${identified} naked-eye stars placed by the Gaia source SIMBAD names them as.`
  );

  const { stars: merged, folded } = foldByIdentity(await mergeWithOtherSources(stars), await glieseGaiaDesignations(rows));
  console.log(`  ${folded} Gliese entries folded into the Gaia source SIMBAD names them as.`);
  merged.sort((a, b) => a.id - b.id);
  return merged;
}

/** How far a naked-eye star may be from its Gaia source, and how much brighter or fainter in G. */
const BRIGHT_COUNTERPART_TOLERANCE_RAD = (5 / 3600) * (Math.PI / 180);
const BRIGHT_COUNTERPART_MAGNITUDES = 1;

/**
 * The Gaia source that is a naked-eye HYG star neither survey places otherwise: the nearest within
 * 5″ of its direction and a magnitude of its V. Found this way, HD 152249 is 4.1″ from where HYG
 * has it, the rest within 1.1″. At 15″, θ¹ Ori (HIP 26220) took the source of θ¹ Ori C, 12.9″ away
 * and already on the map.
 */
function brightCounterpart(row: Record<string, string>, magnitudeV: number, sources: readonly BrightGaiaSource[]): { distancePc: number; relativeError: number } | undefined {
  const [x, y, z] = [Number(row['x']), Number(row['y']), Number(row['z'])];
  const length = Math.hypot(x, y, z);
  let best: BrightGaiaSource | undefined;
  let bestCosine = Math.cos(BRIGHT_COUNTERPART_TOLERANCE_RAD);
  for (const source of sources) {
    const cosine = (x * source.direction.x + y * source.direction.y + z * source.direction.z) / length;
    if (cosine >= bestCosine && Math.abs(source.magnitudeG - magnitudeV) <= BRIGHT_COUNTERPART_MAGNITUDES) {
      best = source;
      bestCosine = cosine;
    }
  }
  return best;
}

/** HYG's Gliese designation as SIMBAD writes it: "Gl 734B" is "GJ 734 B". */
function simbadGliese(gl: string): string {
  return gl.trim().replace(/^Gl\s+/, 'GJ ').replace(/^(GJ \d+(?:\.\d+)?)\s*([A-Z]+)$/, '$1 $2');
}

/**
 * How many HYG rows with a Gliese number SIMBAD names a Gaia source for: 3 352 of HYG's 3 801 on
 * 2026-09-30. SIMBAD's side has its own floor; this one is on the join, where HYG's "Gl 94" has to
 * become SIMBAD's "GJ 94". Joined on HYG's names as they stand, 38 rows were folded instead of 49
 * and the check in build.ts, which takes this map too, still counted none left.
 */
const MIN_GLIESE_IDENTITIES = 3_200;

/**
 * The Gaia DR3 designation SIMBAD gives each HYG star with a Gliese number, by HYG id: what the
 * merge folds its Gliese-only rows by, and what build.ts checks it did. `rows` are HYG's, read
 * again from the cache when not given.
 */
export async function glieseGaiaDesignations(rows?: Record<string, string>[]): Promise<Map<number, string>> {
  const hyg = rows ?? parseCsvObjects(await fetchTextCached(HYG_CSV_URL, 'hygdata_v41.csv'));
  const byGj = await fetchGaiaDesignationsByGj();
  const designations = new Map<number, string>();
  for (const row of hyg) {
    const designation = row['gl'] ? byGj.get(simbadGliese(row['gl'])) : undefined;
    if (designation) {
      designations.set(Number(row['id']), designation);
    }
  }
  if (designations.size < MIN_GLIESE_IDENTITIES) {
    throw new Error(`Only ${designations.size} HYG stars with a Gliese number were matched to SIMBAD's (at least ${MIN_GLIESE_IDENTITIES} expected) — HYG's designations are no longer written as SIMBAD writes them.`);
  }
  return designations;
}

/**
 * Unions HYG with every other positional source that is wired in and reachable.
 *
 * A source that cannot be reached is reported and skipped here rather than thrown, so a run still
 * gets as far as validation and says what it has. Whether that may be published is decided
 * there: `validateMerge` in build.ts refuses a catalogue Gaia contributed nothing to. A source
 * that answered with something unusable ({@link GaiaAnswerError}) is a different matter, and stops
 * the run where it happened rather than being reported later as an outage.
 */
async function mergeWithOtherSources(hygStars: StarRecord[]): Promise<StarRecord[]> {
  const others = positionalSources().filter((source) => source.id !== 'hyg');
  if (others.length === 0) {
    return hygStars;
  }

  const candidates = [{ sourceId: 'hyg', parallaxPrecisionMas: PARALLAX_PRECISION_MAS['hyg'], stars: hygStars }];

  for (const source of others) {
    try {
      candidates.push({
        sourceId: source.id,
        parallaxPrecisionMas: PARALLAX_PRECISION_MAS[source.id] ?? 1,
        stars: await source.fetch!()
      });
    } catch (error) {
      // An answer that cannot be worked with is not an outage: skipping it would write a
      // half-catalogue over the published assets before the merge gate got to say so.
      if (error instanceof GaiaAnswerError) {
        throw error;
      }
      console.log(`  skipping ${source.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (candidates.length === 1) {
    return hygStars;
  }

  const { stars, summary } = mergeStarCatalogues(candidates);
  console.log(`  merged ${summary.total} stars from ${candidates.length} catalogues (${summary.duplicates} entries folded into a better-measured one):`);
  for (const [sourceId, count] of Object.entries(summary.bySource)) {
    console.log(`    ${sourceId}: ${count}`);
  }
  return stars;
}

export function writeStarAssets(stars: StarRecord[]): void {
  ensureDataDir();

  // The layout lives in `star-catalog.ts`, which the app decodes with — one definition, so the
  // writer and the reader cannot drift.
  const { index, positions, meta } = encodeStarCatalog(stars);

  writeFileSync(dataPath('stars.bin'), Buffer.from(positions.buffer));
  writeFileSync(dataPath('stars-meta.bin'), Buffer.from(meta));
  writeFileSync(dataPath('stars-index.json'), JSON.stringify(index));
}

// On its own it writes what the ETL would, hosts included; imported late, since fetchExoplanets imports this module.
if (require.main === module) {
  import('./fetchExoplanets').then(({ fetchExoplanets }) => fetchExoplanets()).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
