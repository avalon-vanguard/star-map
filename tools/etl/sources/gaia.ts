import { createHash } from 'node:crypto';

import { propagateProperMotion, raDegDecDistanceToXyz } from '../../../src/app/shared/astro/coordinates';
import { StarRecord } from '../../../src/app/shared/models/star.model';
import { parseCsvObjects, parseOptionalNumber } from '../lib/csv';
import { fetchTextCached } from '../lib/http';

/**
 * Gaia DR3, via the ESA archive's TAP service.
 *
 * The only one of the large modern surveys that can add stars to a *3D* map, because it is the
 * only one that measures parallaxes for them. Its 1.8 billion sources are roughly 1% of the
 * Galaxy — no catalogue is close to the rest — but within a few hundred parsecs it is complete
 * in a way Hipparcos never was, and its parallaxes are fifty times more precise.
 *
 * Written blind against the published DR3 schema, since no ESA endpoint was reachable from the
 * environment it was written in; first run for real by the scheduled refresh of 2026-08-24, which
 * fetched 412 765 rows.
 */

const GAIA_TAP_URL = 'https://gea.esac.esa.int/tap-server/tap/sync';

/**
 * Gaia DR3 gives positions for J2016.0; HYG for J2000.0, which is the epoch this map keeps.
 * Sixteen years of proper motion is over an arcsecond for anything faster than ~62 mas/yr —
 * which is most of the nearest stars: 62″ for Proxima, 166″ for Barnard's — so as published, the
 * two catalogues never agree on where those stars are, and a merge that matched them on the sky
 * kept every one of them twice. Each position is therefore carried back to J2000.0 with Gaia's
 * own proper motion before it leaves here.
 */
const GAIA_DR3_EPOCH = 2016.0;
const CATALOGUE_EPOCH = 2000.0;

/**
 * How far out to take Gaia, in parsecs, and the faintest star to keep.
 *
 * Both exist to bound the download rather than the science. Gaia's parallaxes stay useful far
 * past anything this map draws, so the limit here is a payload decision: the catalogue is baked
 * into a static asset that a browser downloads before the first frame.
 */
const DEFAULT_DISTANCE_CUTOFF_PC = 250;
const DEFAULT_MAGNITUDE_LIMIT = 12;
const DEFAULT_ROW_LIMIT = 500_000;
const DISTANCE_CUTOFF_PC = Number(process.env['ETL_GAIA_DISTANCE_PC'] ?? DEFAULT_DISTANCE_CUTOFF_PC);
const MAGNITUDE_LIMIT = Number(process.env['ETL_GAIA_MAGNITUDE_LIMIT'] ?? DEFAULT_MAGNITUDE_LIMIT);
const ROW_LIMIT = Number(process.env['ETL_GAIA_ROW_LIMIT'] ?? DEFAULT_ROW_LIMIT);

/**
 * Relative parallax error above which a star is dropped: a parallax measured to worse than 20%
 * gives a distance that is not worth plotting, and inverting a noisy parallax biases it badly.
 */
const MAX_PARALLAX_ERROR_RATIO = 0.2;

/** Parallax in milliarcseconds for a given distance — the query's cutoff, expressed as Gaia has it. */
function parallaxFloorMas(distancePc: number): number {
  return 1000 / distancePc;
}

function buildQuery(): string {
  return [
    `select top ${ROW_LIMIT}`,
    'source_id, ra, dec, pmra, pmdec, parallax, parallax_error, phot_g_mean_mag, bp_rp',
    'from gaiadr3.gaia_source',
    `where parallax > ${parallaxFloorMas(DISTANCE_CUTOFF_PC).toFixed(6)}`,
    `and parallax_over_error > ${(1 / MAX_PARALLAX_ERROR_RATIO).toFixed(1)}`,
    `and phot_g_mean_mag < ${MAGNITUDE_LIMIT}`,
    // source_id breaks the ties — 20 064 groups share a G at the published precision — so the
    // row order, and with it the ids assigned below, is a pure function of the archive's content.
    'order by phot_g_mean_mag asc, source_id asc'
  ].join(' ');
}

/**
 * The nearby complement of the query above: every source it leaves out for being fainter than its
 * magnitude limit, or for having no G at all, out to 50 pc.
 *
 * The limit took a quarter of what lies within 10 pc — 84 of the 312 sources the Gaia Catalogue of
 * Nearby Stars (GCNS; Gaia Collaboration, Smart et al. 2021, A&A 649, A6) has there, Teegarden's
 * Star among them — and 28 012 within 50 pc: the red, brown and white dwarfs most of the Sun's
 * neighbourhood is made of, which the map only had where Gliese happened to list them. Further out
 * the same band is far too many rows to ship (G 12–13 alone is 188 408 within 250 pc).
 *
 * Only sources the GCNS keeps. Its classifier rejects 11 752 of the 39 764 that pass this parallax
 * floor, and the parallax error the main query filters on would keep all but 13 of them: they are
 * spurious parallaxes — median G 20.2 and 5.4 mas of astrometric excess noise, against 0.15 mas for
 * the ones it keeps; 6 933 of them toward the crowded Galactic centre. GCNS was built on EDR3,
 * whose astrometry and source ids DR3 carries unchanged. The error cut is kept for consistency; it
 * costs no GCNS source here, brown dwarfs included.
 */
const NEARBY_DISTANCE_PC = 50;

function buildNearbyQuery(): string {
  return [
    `select top ${ROW_LIMIT}`,
    'g.source_id, g.ra, g.dec, g.pmra, g.pmdec, g.parallax, g.parallax_error, g.phot_g_mean_mag, g.bp_rp',
    'from gaiadr3.gaia_source g join external.gaiaedr3_gcns_main_1 n on n.source_id = g.source_id',
    `where g.parallax > ${parallaxFloorMas(NEARBY_DISTANCE_PC).toFixed(6)}`,
    `and g.parallax_over_error > ${(1 / MAX_PARALLAX_ERROR_RATIO).toFixed(1)}`,
    `and (g.phot_g_mean_mag >= ${MAGNITUDE_LIMIT} or g.phot_g_mean_mag is null)`,
    'order by g.phot_g_mean_mag asc, g.source_id asc'
  ].join(' ');
}

/**
 * How many rows the query above holds when nothing is overridden: 412 765, and DR3 is a finished
 * data release, so that number only moves when the query does. It lives here, under the query, so
 * that an edit to any of its filters is made with the count it invalidates in view.
 *
 * Checked because a short answer looks exactly like a complete one. The TAP service truncates on
 * its own timeout and still serves a well-formed CSV with a 200, and the rows are ordered by
 * magnitude, so what comes back is the bright half — the half HYG overlaps. The merge gate in
 * `build.ts` would then see Gaia stars present and a survivor count barely moved, and pass a
 * catalogue missing two hundred thousand stars, which the weekly job would publish and the runner
 * would cache for the weeks after it. Same failure, and same guard, as
 * {@link MIN_USABLE_HIP_DISTANCES} below.
 *
 * Only checked when nothing is overridden: the environment overrides exist to fetch a smaller
 * slice on purpose.
 */
const DEFAULT_QUERY_ROWS = 412_765;
/** The same count for the nearby query, which the same truncation would cut from its faint end. */
const DEFAULT_NEARBY_QUERY_ROWS = 28_012;
const MIN_ROW_SHARE = 0.95;

/**
 * An answer the archive gave that cannot be worked with, as against an archive that gave none.
 *
 * `fetchStars` skips a source it cannot reach and leaves the merge gate to judge the result. That
 * is right for an outage and wrong for a truncated CSV, which would be skipped, cached, and land
 * as "the archive was unreachable" long after the assets had been overwritten — so these throws
 * are marked, and rethrown there.
 */
export class GaiaAnswerError extends Error {}

/**
 * Gaia publishes no spectral classifications. Its `bp_rp` is a colour index, though not HYG's
 * B−V — `colorSystem` says which — and the spectral type is left as unknown rather than
 * invented from it; the app estimates one, and says it is an estimate.
 */
const UNKNOWN_SPECTRAL_TYPE = 'Unknown';

/**
 * Gaia source ids are 19 digits and there are no proper names, so a star's identity here is its
 * catalogue designation. The app's star ids are 32-bit, which a Gaia source id overflows, so the
 * two are kept apart: `id` is assigned within this run's own range and the designation carries
 * the real identifier in the name.
 */
const GAIA_ID_BASE = 1_000_000_000;
/**
 * Where the nearby query's ids start: fifty million past the main query's, and under 2^30, the
 * largest integer V8 keeps unboxed. The Int32 id column would take up to 2^31, but every id past
 * 2^30 is a heap number in the app: starting these at 2 000 000 000 made the boot task that
 * indexes the catalogue 230 ms longer (1.41 s against 1.18, medians of five interleaved runs).
 */
const NEARBY_ID_BASE = 1_050_000_000;

export async function fetchGaiaStars(): Promise<StarRecord[]> {
  const unchanged = MAGNITUDE_LIMIT === DEFAULT_MAGNITUDE_LIMIT && ROW_LIMIT === DEFAULT_ROW_LIMIT;
  console.log(`Fetching Gaia DR3 (within ${DISTANCE_CUTOFF_PC} pc, G < ${MAGNITUDE_LIMIT}, at most ${ROW_LIMIT} rows)...`);
  const rows = await fetchQueryRows(buildQuery(), unchanged && DISTANCE_CUTOFF_PC === DEFAULT_DISTANCE_CUTOFF_PC ? DEFAULT_QUERY_ROWS : undefined);
  console.log(`Fetching Gaia DR3's nearby complement (within ${NEARBY_DISTANCE_PC} pc, G >= ${MAGNITUDE_LIMIT} or none, kept by the GCNS)...`);
  const nearbyRows = await fetchQueryRows(buildNearbyQuery(), unchanged ? DEFAULT_NEARBY_QUERY_ROWS : undefined);

  const stars = [...rowsToStars(rows, GAIA_ID_BASE), ...rowsToStars(nearbyRows, NEARBY_ID_BASE)];
  console.log(`  kept ${stars.length} Gaia stars (of ${rows.length} + ${nearbyRows.length} rows).`);
  return stars;
}

/**
 * One query's rows, refused when there are fewer than `expectedRows` — see
 * {@link DEFAULT_QUERY_ROWS} — or as many as the row limit.
 */
async function fetchQueryRows(query: string, expectedRows: number | undefined): Promise<Record<string, string>[]> {
  const url = `${GAIA_TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(query)}`;
  // Keyed by the whole request, so a response cached for other columns, another order, or
  // another endpoint can never be mistaken for this one — the cache records only that some
  // response arrived, not what it answered.
  const cacheKey = `gaia-dr3-${createHash('sha1').update(url).digest('hex').slice(0, 8)}.csv`;
  const rows = parseCsvObjects(await fetchTextCached(url, cacheKey));
  if (expectedRows !== undefined && rows.length < expectedRows * MIN_ROW_SHARE) {
    throw new GaiaAnswerError(
      `Gaia returned ${rows.length} rows, not the ~${expectedRows} this query holds — the answer was cut short, it was an error page ` +
        `served with a 200, or the query was edited without updating its row count; delete tools/etl/.cache/${cacheKey} once the archive answers properly`
    );
  }
  // Not gated like the floor above it: the only ways to reach this cap are the overrides that
  // *widen* the query, and they are exactly when it is worth saying. What it must not fire on is
  // a deliberately smaller slice, where filling the limit is the whole point.
  if (ROW_LIMIT >= DEFAULT_ROW_LIMIT && rows.length >= ROW_LIMIT) {
    throw new GaiaAnswerError(`Gaia returned the query's own ${ROW_LIMIT}-row limit, so it is the limit deciding what the map holds; raise ETL_GAIA_ROW_LIMIT.`);
  }
  return rows;
}

/** Places each row at J2000.0, numbering them from `idBase` in the query's own order. */
function rowsToStars(rows: readonly Record<string, string>[], idBase: number): StarRecord[] {
  const stars: StarRecord[] = [];

  rows.forEach((row, index) => {
    const parallaxMas = parseOptionalNumber(row['parallax']);
    const raDeg = parseOptionalNumber(row['ra']);
    const decDeg = parseOptionalNumber(row['dec']);
    if (!parallaxMas || parallaxMas <= 0 || raDeg === undefined || decDeg === undefined) {
      return;
    }

    const distancePc = 1000 / parallaxMas;
    if (distancePc > DISTANCE_CUTOFF_PC) {
      return;
    }

    const parallaxErrorMas = parseOptionalNumber(row['parallax_error']);
    const pmRaMasYr = parseOptionalNumber(row['pmra']);
    const pmDecMasYr = parseOptionalNumber(row['pmdec']);
    const j2000 = propagateProperMotion(raDeg, decDeg, pmRaMasYr ?? 0, pmDecMasYr ?? 0, CATALOGUE_EPOCH - GAIA_DR3_EPOCH);
    const { x, y, z } = raDegDecDistanceToXyz(j2000.raDeg, j2000.decDeg, distancePc);
    const magnitudeG = parseOptionalNumber(row['phot_g_mean_mag']);
    const colorIndex = parseOptionalNumber(row['bp_rp']);
    stars.push({
      id: idBase + index,
      name: `Gaia DR3 ${row['source_id']}`,
      gaiaDesignation: `Gaia DR3 ${row['source_id']}`,
      x,
      y,
      z,
      // Only the nearby query has sources without a G, 45 of them, and they are given its limit.
      // That errs bright: 26 of the 31 that 2MASS measured are at J 12.6–15.7, fainter still in G
      // for stars this red, and 5 at J 7–8.
      magnitude: magnitudeG ?? MAGNITUDE_LIMIT,
      ...(magnitudeG === undefined ? {} : { magnitudeBand: 'G' as const }),
      spectralType: UNKNOWN_SPECTRAL_TYPE,
      colorIndex: colorIndex ?? null,
      ...(colorIndex === undefined ? {} : { colorSystem: 'BP-RP' as const }),
      ...(parallaxErrorMas === undefined ? {} : { distanceError: parallaxErrorMas / parallaxMas }),
      distanceFromGaia: true,
      source: 'gaia',
      pmRaMasYr,
      pmDecMasYr
    });
  });

  return stars;
}

/**
 * DR3's Hipparcos cross-match is a fixed table of 99 525 rows, 97 751 of them with a usable
 * parallax. Far fewer means the answer was an error page served with a 200, or was cut short,
 * and either would pass for "Gaia does not know these stars" and put every one of them back at
 * its Hipparcos distance.
 */
const MIN_USABLE_HIP_DISTANCES = 90_000;

/**
 * Gaia's distance for every Hipparcos star it has a usable parallax for, and that distance's
 * relative error, keyed by HIP number.
 *
 * Taken from the archive's own cross-match (`hipparcos2_best_neighbour`) rather than from
 * matching positions here, since Gaia's team made that identification star by star with the
 * proper motions and photometry in hand. It is deliberately not bounded by distance: the stars
 * it exists for are the ones Hipparcos put inside the map and Gaia puts outside, which the main
 * query above never fetches.
 *
 * Required rather than best effort. Without it every HYG star falls back to its Hipparcos
 * distance, the 6 833 that Gaia puts past 250 pc move back inside, and the published map would
 * flip between the two with the archive's availability.
 */
export async function fetchGaiaDistancesByHip(): Promise<Map<number, { distancePc: number; relativeError: number }>> {
  const query = [
    'select top 200000 b.original_ext_source_id as hip, g.parallax, g.parallax_over_error',
    'from gaiadr3.hipparcos2_best_neighbour b join gaiadr3.gaia_source g on g.source_id = b.source_id'
  ].join(' ');
  const url = `${GAIA_TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(query)}`;
  console.log('Fetching Gaia DR3 distances for Hipparcos stars (archive cross-match)...');
  const rows = parseCsvObjects(await fetchTextCached(url, `gaia-dr3-hip-${createHash('sha1').update(url).digest('hex').slice(0, 8)}.csv`));

  const distances = new Map<number, { distancePc: number; relativeError: number }>();
  for (const row of rows) {
    const hip = parseOptionalNumber(row['hip']);
    const parallaxMas = parseOptionalNumber(row['parallax']);
    const overError = parseOptionalNumber(row['parallax_over_error']);
    if (hip !== undefined && parallaxMas !== undefined && parallaxMas > 0 && overError !== undefined && overError > 1 / MAX_PARALLAX_ERROR_RATIO) {
      distances.set(hip, { distancePc: 1000 / parallaxMas, relativeError: 1 / overError });
    }
  }
  if (distances.size < MIN_USABLE_HIP_DISTANCES) {
    throw new Error(
      `the Hipparcos cross-match gave ${distances.size} usable distances (of ${rows.length} rows), not the ~97 751 it holds; ` +
        'delete tools/etl/.cache/gaia-dr3-hip-*.csv once the archive answers properly'
    );
  }
  console.log(`  ${distances.size} Hipparcos stars have a Gaia distance (of ${rows.length} cross-matched).`);
  return distances;
}

/**
 * How bright a Gaia source must be to stand in for a naked-eye HYG star, in G, and how many the
 * archive holds that bright with a usable parallax: 35 910 on 2026-09-30.
 */
const BRIGHT_MAGNITUDE_LIMIT = 7.5;
const BRIGHT_QUERY_ROWS = 35_910;

/** A bright Gaia source's designation, J2000 direction, G magnitude and distance. */
export interface BrightGaiaSource {
  designation: string;
  direction: { x: number; y: number; z: number };
  magnitudeG: number;
  distancePc: number;
  relativeError: number;
}

/**
 * Every Gaia DR3 source brighter than G 7.5 with a usable parallax, at J2000: for the naked-eye
 * HYG stars nothing else places, found by position. The Hipparcos cross-match above lacks some of
 * their HIP numbers, and the HYG rows with no HIP number were never looked up at all. Of the 34
 * HYG stars of V 6.5 or brighter left off the map for want of a distance, 12 are found here: ten
 * that were missing, 66 Ori and HD 197770 (1.102 ± 0.029 mas) among them, and HD 45291 and
 * HD 124953, which were on the map only as bare Gaia entries a second of arc from where HYG has them.
 */
export async function fetchBrightGaiaSources(): Promise<BrightGaiaSource[]> {
  const query = [
    `select top ${ROW_LIMIT} source_id, ra, dec, pmra, pmdec, parallax, parallax_over_error, phot_g_mean_mag`,
    'from gaiadr3.gaia_source',
    `where phot_g_mean_mag < ${BRIGHT_MAGNITUDE_LIMIT} and parallax_over_error > ${(1 / MAX_PARALLAX_ERROR_RATIO).toFixed(1)}`,
    'order by source_id'
  ].join(' ');
  console.log(`Fetching Gaia DR3's sources brighter than G ${BRIGHT_MAGNITUDE_LIMIT}, for the naked-eye stars the cross-match lacks...`);
  const rows = await fetchQueryRows(query, BRIGHT_QUERY_ROWS);
  const sources: BrightGaiaSource[] = [];
  for (const row of rows) {
    const [raDeg, decDeg, parallaxMas, overError, magnitudeG] = ['ra', 'dec', 'parallax', 'parallax_over_error', 'phot_g_mean_mag'].map((column) => parseOptionalNumber(row[column]));
    if (raDeg === undefined || decDeg === undefined || !parallaxMas || parallaxMas <= 0 || overError === undefined || magnitudeG === undefined) {
      continue;
    }
    const j2000 = propagateProperMotion(raDeg, decDeg, parseOptionalNumber(row['pmra']) ?? 0, parseOptionalNumber(row['pmdec']) ?? 0, CATALOGUE_EPOCH - GAIA_DR3_EPOCH);
    sources.push({ designation: `Gaia DR3 ${row['source_id']}`, direction: raDegDecDistanceToXyz(j2000.raDeg, j2000.decDeg, 1), magnitudeG, distancePc: 1000 / parallaxMas, relativeError: 1 / overError });
  }
  return sources;
}

/** The new Hipparcos reduction holds 117 955 stars, and every one has a parallax error. */
const MIN_HIPPARCOS_ERRORS = 110_000;

/**
 * Every Hipparcos parallax with its relative error, keyed by HIP number: to choose between it and
 * Gaia's, and for the stars that keep their Hipparcos distance — Rigel and Deneb, which Gaia has
 * no usable parallax for, and the few hundred bright stars where Gaia's is the less precise.
 *
 * From van Leeuwen's 2007 reduction, which the ESA archive hosts beside Gaia and HYG's distances
 * are the inverse of. HYG publishes the distance and not its error.
 */
export async function fetchHipparcosParallaxErrors(): Promise<Map<number, { parallaxMas: number; relativeError: number }>> {
  const url = `${GAIA_TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent('select top 200000 hip, plx, e_plx from public.hipparcos_newreduction order by hip')}`;
  console.log('Fetching Hipparcos parallax errors (new reduction)...');
  const rows = parseCsvObjects(await fetchTextCached(url, `hipparcos-errors-${createHash('sha1').update(url).digest('hex').slice(0, 8)}.csv`));

  const errors = new Map<number, { parallaxMas: number; relativeError: number }>();
  for (const row of rows) {
    const hip = parseOptionalNumber(row['hip']);
    const parallaxMas = parseOptionalNumber(row['plx']);
    const errorMas = parseOptionalNumber(row['e_plx']);
    if (hip !== undefined && parallaxMas !== undefined && parallaxMas > 0 && errorMas !== undefined) {
      errors.set(hip, { parallaxMas, relativeError: errorMas / parallaxMas });
    }
  }
  if (errors.size < MIN_HIPPARCOS_ERRORS) {
    throw new Error(`the Hipparcos reduction gave ${errors.size} parallax errors (of ${rows.length} rows), not the ~117 955 it holds; delete tools/etl/.cache/hipparcos-errors-*.csv once the archive answers properly`);
  }
  return errors;
}
