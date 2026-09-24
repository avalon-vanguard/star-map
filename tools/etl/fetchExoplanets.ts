import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { buildStarNameIndex, resolveHostStarId } from '../../src/app/shared/astro/host-star-matching';
import { ExoplanetRecord } from '../../src/app/shared/models/exoplanet.model';
import { isDesignation } from '../../src/app/shared/models/star-catalog';
import { StarRecord } from '../../src/app/shared/models/star.model';
import { fetchStars, writeStarAssets } from './fetchStars';
import { parseCsvObjects, parseOptionalNumber } from './lib/csv';
import { fetchTextCached } from './lib/http';
import { dataPath, ensureDataDir } from './lib/paths';

const TAP_BASE_URL = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const TAP_COLUMNS = [
  'pl_name',
  'hostname',
  'ra',
  'dec',
  'sy_dist',
  'sy_pmra',
  'sy_pmdec',
  'pl_orbsmax',
  'pl_orbeccen',
  'pl_orbincl',
  'pl_orblper',
  'pl_orbper',
  'pl_rade',
  'pl_bmasse',
  'st_mass',
  'disc_year'
].join(',');
// Ordered explicitly: without it the archive is free to return rows in any order, and a
// scheduled re-run of the ETL would then rewrite exoplanets.json — and commit a diff — when
// nothing was actually published. pl_name is unique among default_flag=1 rows, so the order
// is total and the output is a pure function of the archive's content.
const TAP_QUERY = `select+${TAP_COLUMNS}+from+ps+where+default_flag=1+order+by+pl_name&format=csv`;
const TAP_URL = `${TAP_BASE_URL}?query=${TAP_QUERY}`;

// The cache is keyed by the request it answers — endpoint included, since the cache records
// only that some response arrived: one cached before a column was added would otherwise keep
// serving rows without it, and a missing proper-motion cell reads as "does not move",
// silently wrong rather than visibly broken.
const CACHE_FILE = `exoplanet-archive-ps-${createHash('sha1').update(TAP_URL).digest('hex').slice(0, 8)}.csv`;

/**
 * The host's columns from the Planetary Systems Composite table, for the cells a planet's
 * default row leaves blank and for the columns that query does not ask for.
 *
 * The default rows are one reference each, which is what keeps a planet's orbit coherent: its
 * period, semi-major axis, eccentricity and periastron come from one fit. A composite row takes
 * each column from wherever it is best measured, so an orbit read from it could pair one paper's
 * eccentricity with another's argument of periastron; none of its orbital columns are asked for.
 * Its system columns equal the default rows' wherever both are given (6 225 distances, 6 352
 * positions, none different). What it adds is the 100 distances the default rows leave blank,
 * TRAPPIST-1's seven among them, 870 host masses, and the parallax, photometry and stellar
 * parameters below — each of which may come from a different reference.
 */
const COMPOSITE_COLUMNS = [
  'pl_name',
  'ra',
  'dec',
  'sy_dist',
  'sy_plx',
  'sy_pmra',
  'sy_pmdec',
  'sy_bmag',
  'sy_vmag',
  'sy_gaiamag',
  'st_spectype',
  'st_teff',
  'st_rad',
  'st_mass',
  'st_lum'
].join(',');
// pl_name is unique here too, one row per planet.
const COMPOSITE_URL = `${TAP_BASE_URL}?query=select+${COMPOSITE_COLUMNS}+from+pscomppars+order+by+pl_name&format=csv`;
const COMPOSITE_CACHE_FILE = `exoplanet-archive-pscomppars-${createHash('sha1').update(COMPOSITE_URL).digest('hex').slice(0, 8)}.csv`;

/**
 * Downloads confirmed exoplanets from the NASA Exoplanet Archive (`Planetary Systems` TAP
 * table), cross-references each host star to the star catalogue, and writes `exoplanets.json`
 * together with the star assets, whose Gaia designations take their host's name. Returns both.
 */
export async function fetchExoplanets(stars?: StarRecord[]): Promise<{ exoplanets: ExoplanetRecord[]; stars: StarRecord[] }> {
  console.log('Fetching confirmed exoplanets from the NASA Exoplanet Archive...');
  const knownStars = stars ?? (await fetchStars());
  const nameIndex = buildStarNameIndex(knownStars);
  const knownById = new Map(knownStars.map((star) => [star.id, star]));

  const csv = await fetchTextCached(TAP_URL, CACHE_FILE);
  const rows = parseCsvObjects(csv);
  const composite = new Map(parseCsvObjects(await fetchTextCached(COMPOSITE_URL, COMPOSITE_CACHE_FILE)).map((row) => [row['pl_name'], row]));

  let matched = 0;
  // Catalogue stars known only by their Gaia designation, which take the archive's host name —
  // the only way "TRAPPIST-1" or "Teegarden's Star" can be found by search.
  const renamed = new Map<number, string>();
  const exoplanets: ExoplanetRecord[] = rows.map((row, index) => {
    const compositeRow = composite.get(row['pl_name']);
    // `parseOptionalNumber`, not `Number`: a blank cell would otherwise become 0, which is a
    // finite, plausible-looking coordinate rather than the "not measured" it actually means.
    const host = (column: string) => parseOptionalNumber(row[column] || compositeRow?.[column]);
    const raDeg = host('ra') ?? Number.NaN;
    const decDeg = host('dec') ?? Number.NaN;
    const distancePc = host('sy_dist') ?? Number.NaN;
    const pmRaMasPerYear = host('sy_pmra');
    const pmDecMasPerYear = host('sy_pmdec');

    const hostStarId = resolveHostStarId(
      { hostname: row['hostname'], raDeg, decDeg, distancePc, pmRaMasPerYear, pmDecMasPerYear, parallaxMas: host('sy_plx') },
      knownStars,
      nameIndex
    );
    if (hostStarId !== null) {
      matched++;
      const star = knownById.get(hostStarId);
      if (star?.source === 'gaia' && isDesignation(star) && !renamed.has(hostStarId)) {
        renamed.set(hostStarId, row['hostname']);
      }
    }

    return {
      id: row['pl_name'] || `exoplanet-${index}`,
      hostStarId,
      hostStarName: row['hostname'],
      name: row['pl_name'],
      radiusEarth: parseOptionalNumber(row['pl_rade']),
      massEarth: parseOptionalNumber(row['pl_bmasse']),
      discoveryYear: parseOptionalNumber(row['disc_year']),
      // The period was already being downloaded and thrown away. With the semi-major axis it
      // determines the host's gravitational parameter, so keeping it is the difference between
      // propagating a planet at its real rate and pretending every host is the Sun.
      periodDays: parseOptionalNumber(row['pl_orbper']),
      hostStarMassSolar: host('st_mass'),
      hostStarRadiusSolar: host('st_rad'),
      hostStarTemperatureK: host('st_teff'),
      // Published as log10(L/L☉).
      hostStarLuminositySolar: ((logLuminosity) => (logLuminosity === undefined ? undefined : 10 ** logLuminosity))(host('st_lum')),
      // Kept so the cross-reference can be redone without the archive; see the record's own
      // documentation. Undefined rather than NaN, which JSON cannot represent.
      hostRaDeg: host('ra'),
      hostDecDeg: host('dec'),
      hostDistancePc: host('sy_dist'),
      hostPmRaMasPerYear: pmRaMasPerYear,
      hostPmDecMasPerYear: pmDecMasPerYear,
      orbit: {
        semiMajorAxisAu: parseOptionalNumber(row['pl_orbsmax']),
        eccentricity: parseOptionalNumber(row['pl_orbeccen']),
        inclinationDeg: parseOptionalNumber(row['pl_orbincl']),
        argumentOfPeriapsisDeg: parseOptionalNumber(row['pl_orblper'])
      }
    };
  });

  const allStars = knownStars.map((star) => (renamed.has(star.id) ? { ...star, name: renamed.get(star.id)! } : star));
  writeStarAssets(allStars);

  ensureDataDir();
  writeFileSync(dataPath('exoplanets.json'), JSON.stringify(exoplanets));
  console.log(`  wrote ${exoplanets.length} exoplanets (${matched} on a catalogue star, ${renamed.size} Gaia designations named after their host).`);
  return { exoplanets, stars: allStars };
}

if (require.main === module) {
  fetchExoplanets().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
