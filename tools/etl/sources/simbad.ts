import { createHash } from 'node:crypto';

import { parseCsvObjects } from '../lib/csv';
import { fetchTextCached } from '../lib/http';

/**
 * SIMBAD, via its TAP service, for one thing: which Gaia DR3 source a star is.
 *
 * The merge decides identity on the sky, and for the HYG rows Gliese places without Hipparcos
 * astrometry the sky is not enough: their positions are off by up to minutes of arc, their
 * distances are photometric and their proper motions sometimes wrong. SIMBAD's cross-identifications
 * were made star by star, and name the answer.
 */

const SIMBAD_TAP_URL = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';

/** SIMBAD gave 4 868 GJ designations a Gaia DR3 one on 2026-09-30. */
const MIN_GJ_DESIGNATIONS = 4_000;

/**
 * SIMBAD's Gaia DR3 designation for every object it knows by a Gliese-Jahreiss number, keyed by
 * that number with its spaces collapsed, as SIMBAD writes it: "GJ 734 B", not HYG's "Gl 734B".
 * One query for the whole catalogue rather than for the rows that need it, so the answer, and its
 * cache, do not change when those rows do.
 */
export async function fetchGaiaDesignationsByGj(): Promise<Map<string, string>> {
  const designations = await fetchDesignations(
    "select i1.id as gj, i2.id as gaia from ident as i1 join ident as i2 on i1.oidref = i2.oidref where i1.id like 'GJ %' and i2.id like 'Gaia DR3 %' order by gj, gaia",
    'gj',
    'simbad-gj-gaia'
  );
  if (designations.size < MIN_GJ_DESIGNATIONS) {
    throw new Error(`SIMBAD gave ${designations.size} GJ stars a Gaia DR3 designation, not the ~4 868 it holds; delete tools/etl/.cache/simbad-gj-gaia-*.csv once it answers properly`);
  }
  return designations;
}

/** Of the 206 HD numbers asked for below, SIMBAD gave 199 a Gaia DR3 designation on 2026-09-30. */
const MIN_HD_DESIGNATION_SHARE = 0.9;

/**
 * SIMBAD's Gaia DR3 designation for each of `hdNumbers`, keyed "HD 45951": for the naked-eye HYG
 * rows with no distance, which HYG's own position does not always lead to — HD 45951's declination
 * there is 31.7′ off SIMBAD's. Asked by number, since the HD catalogue whole would be 360 000 rows;
 * the numbers are HYG's, so the answer and its cache change only when HYG does.
 */
export async function fetchGaiaDesignationsByHd(hdNumbers: readonly string[]): Promise<Map<string, string>> {
  const list = [...hdNumbers].sort().map((hd) => `'HD ${hd}'`).join(', ');
  const designations = await fetchDesignations(
    `select i1.id as hd, i2.id as gaia from ident as i1 join ident as i2 on i1.oidref = i2.oidref where i1.id in (${list}) and i2.id like 'Gaia DR3 %' order by hd, gaia`,
    'hd',
    'simbad-hd-gaia'
  );
  if (designations.size < hdNumbers.length * MIN_HD_DESIGNATION_SHARE) {
    throw new Error(`SIMBAD gave ${designations.size} of ${hdNumbers.length} HD stars a Gaia DR3 designation; delete tools/etl/.cache/simbad-hd-gaia-*.csv once it answers properly`);
  }
  return designations;
}

/** The identifier in `column` → Gaia DR3 designation pairs a query answers, SIMBAD's padding collapsed ("HD  45951"). */
async function fetchDesignations(query: string, column: string, cachePrefix: string): Promise<Map<string, string>> {
  const url = `${SIMBAD_TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(query)}`;
  const rows = parseCsvObjects(await fetchTextCached(url, `${cachePrefix}-${createHash('sha1').update(url).digest('hex').slice(0, 8)}.csv`));

  const designations = new Map<string, string>();
  for (const row of rows) {
    const identifier = collapse(row[column] ?? '');
    // An object SIMBAD gives two Gaia DR3 sources is one it has not resolved; neither is the star.
    designations.set(identifier, designations.has(identifier) ? '' : collapse(row['gaia'] ?? ''));
  }
  for (const [identifier, designation] of designations) {
    if (!designation) {
      designations.delete(identifier);
    }
  }
  return designations;
}

function collapse(identifier: string): string {
  return identifier.replace(/\s+/g, ' ').trim();
}
