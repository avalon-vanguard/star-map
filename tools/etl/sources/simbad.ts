import { createHash } from 'node:crypto';

import { parseCsvObjects } from '../lib/csv';
import { fetchTextCached } from '../lib/http';

/**
 * SIMBAD, via its TAP service, for one thing: which Gaia DR3 source a Gliese star is.
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
  const query =
    "select i1.id as gj, i2.id as gaia from ident as i1 join ident as i2 on i1.oidref = i2.oidref where i1.id like 'GJ %' and i2.id like 'Gaia DR3 %' order by gj, gaia";
  const url = `${SIMBAD_TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(query)}`;
  const rows = parseCsvObjects(await fetchTextCached(url, `simbad-gj-gaia-${createHash('sha1').update(url).digest('hex').slice(0, 8)}.csv`));

  const designations = new Map<string, string>();
  for (const row of rows) {
    const gj = collapse(row['gj'] ?? '');
    // An object SIMBAD gives two Gaia DR3 sources is one it has not resolved; neither is the star.
    designations.set(gj, designations.has(gj) ? '' : collapse(row['gaia'] ?? ''));
  }
  for (const [gj, designation] of designations) {
    if (!designation) {
      designations.delete(gj);
    }
  }
  if (designations.size < MIN_GJ_DESIGNATIONS) {
    throw new Error(`SIMBAD gave ${designations.size} GJ stars a Gaia DR3 designation (of ${rows.length} rows), not the ~4 868 it holds; delete tools/etl/.cache/simbad-gj-gaia-*.csv once it answers properly`);
  }
  return designations;
}

function collapse(identifier: string): string {
  return identifier.replace(/\s+/g, ' ').trim();
}
