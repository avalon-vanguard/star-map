import { raDegDecDistanceToXyz } from '../../../src/app/shared/astro/coordinates';
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
 * **This has never been run.** Every ESA, NOIRLab, SDSS and Euclid endpoint is unreachable from
 * the environment this was written in, so the query below is written against the published DR3
 * schema and has not been executed against it. Treat the column names as the first thing to
 * check if a real run misbehaves.
 */

const GAIA_TAP_URL = 'https://gea.esac.esa.int/tap-server/tap/sync';

/**
 * How far out to take Gaia, in parsecs, and the faintest star to keep.
 *
 * Both exist to bound the download rather than the science. Gaia's parallaxes stay useful far
 * past anything this map draws, so the limit here is a payload decision: the catalogue is baked
 * into a static asset that a browser downloads before the first frame.
 */
const DISTANCE_CUTOFF_PC = Number(process.env['ETL_GAIA_DISTANCE_PC'] ?? 250);
const MAGNITUDE_LIMIT = Number(process.env['ETL_GAIA_MAGNITUDE_LIMIT'] ?? 12);
const ROW_LIMIT = Number(process.env['ETL_GAIA_ROW_LIMIT'] ?? 500000);

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
    'source_id, ra, dec, parallax, parallax_error, phot_g_mean_mag, bp_rp',
    'from gaiadr3.gaia_source',
    `where parallax > ${parallaxFloorMas(DISTANCE_CUTOFF_PC).toFixed(6)}`,
    `and parallax_over_error > ${(1 / MAX_PARALLAX_ERROR_RATIO).toFixed(1)}`,
    `and phot_g_mean_mag < ${MAGNITUDE_LIMIT}`,
    'order by phot_g_mean_mag asc'
  ].join(' ');
}

/**
 * Gaia publishes no spectral classifications, but `bp_rp` is a colour index on the same footing
 * as HYG's `ci` — so the app's existing colour and spectral-class handling works unchanged, and
 * the spectral type is left as unknown rather than invented from the colour.
 */
const UNKNOWN_SPECTRAL_TYPE = 'Unknown';

/**
 * Gaia source ids are 19 digits and there are no proper names, so a star's identity here is its
 * catalogue designation. The app's star ids are 32-bit, which a Gaia source id overflows, so the
 * two are kept apart: `id` is assigned within this run's own range and the designation carries
 * the real identifier in the name.
 */
const GAIA_ID_BASE = 1_000_000_000;

export async function fetchGaiaStars(): Promise<StarRecord[]> {
  const url = `${GAIA_TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(buildQuery())}`;
  console.log(`Fetching Gaia DR3 (within ${DISTANCE_CUTOFF_PC} pc, G < ${MAGNITUDE_LIMIT}, at most ${ROW_LIMIT} rows)...`);

  const csv = await fetchTextCached(url, 'gaia-dr3.csv');
  const rows = parseCsvObjects(csv);
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

    const { x, y, z } = raDegDecDistanceToXyz(raDeg, decDeg, distancePc);
    stars.push({
      id: GAIA_ID_BASE + index,
      name: `Gaia DR3 ${row['source_id']}`,
      x,
      y,
      z,
      magnitude: parseOptionalNumber(row['phot_g_mean_mag']) ?? MAGNITUDE_LIMIT,
      spectralType: UNKNOWN_SPECTRAL_TYPE,
      colorIndex: parseOptionalNumber(row['bp_rp']) ?? null,
      source: 'gaia'
    });
  });

  console.log(`  kept ${stars.length} Gaia stars (of ${rows.length} rows).`);
  return stars;
}
