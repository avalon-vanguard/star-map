import { writeFileSync } from 'node:fs';

import { buildStarNameIndex, resolveHostStarId } from '../../src/app/shared/astro/host-star-matching';
import { ExoplanetRecord } from '../../src/app/shared/models/exoplanet.model';
import { StarRecord } from '../../src/app/shared/models/star.model';
import { fetchStars } from './fetchStars';
import { parseCsvObjects } from './lib/csv';
import { fetchTextCached } from './lib/http';
import { dataPath, ensureDataDir } from './lib/paths';

const TAP_BASE_URL = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const TAP_COLUMNS = [
  'pl_name',
  'hostname',
  'ra',
  'dec',
  'sy_dist',
  'pl_orbsmax',
  'pl_orbeccen',
  'pl_orbincl',
  'pl_orblper',
  'pl_orbper',
  'pl_rade',
  'pl_bmasse',
  'disc_year'
].join(',');
const TAP_QUERY = `select+${TAP_COLUMNS}+from+ps+where+default_flag=1&format=csv`;
const TAP_URL = `${TAP_BASE_URL}?query=${TAP_QUERY}`;

// A host star match must be within this many parsecs of the catalog position to be
// accepted as a cross-reference (guards against coincidental name/position collisions).
const MATCH_TOLERANCE_PC = 0.5;

/**
 * Downloads confirmed exoplanets from the NASA Exoplanet Archive (`Planetary Systems` TAP
 * table), cross-references each host star to the HYG index, and writes `exoplanets.json`.
 */
export async function fetchExoplanets(stars?: StarRecord[]): Promise<ExoplanetRecord[]> {
  console.log('Fetching confirmed exoplanets from the NASA Exoplanet Archive...');
  const knownStars = stars ?? (await fetchStars());
  const nameIndex = buildStarNameIndex(knownStars);

  const csv = await fetchTextCached(TAP_URL, 'exoplanet-archive-ps.csv');
  const rows = parseCsvObjects(csv);

  let matched = 0;
  const exoplanets: ExoplanetRecord[] = rows.map((row, index) => {
    // `parseOptionalNumber`, not `Number`: a blank cell would otherwise become 0, which is a
    // finite, plausible-looking coordinate rather than the "not measured" it actually means.
    const raDeg = parseOptionalNumber(row['ra']) ?? Number.NaN;
    const decDeg = parseOptionalNumber(row['dec']) ?? Number.NaN;
    const distancePc = parseOptionalNumber(row['sy_dist']) ?? Number.NaN;

    const hostStarId = resolveHostStarId(
      { hostname: row['hostname'], raDeg, decDeg, distancePc },
      knownStars,
      MATCH_TOLERANCE_PC,
      nameIndex
    );
    if (hostStarId !== null) {
      matched++;
    }

    return {
      id: row['pl_name'] || `exoplanet-${index}`,
      hostStarId,
      hostStarName: row['hostname'],
      name: row['pl_name'],
      radiusEarth: parseOptionalNumber(row['pl_rade']),
      massEarth: parseOptionalNumber(row['pl_bmasse']),
      discoveryYear: parseOptionalNumber(row['disc_year']),
      orbit: {
        semiMajorAxisAu: parseOptionalNumber(row['pl_orbsmax']),
        eccentricity: parseOptionalNumber(row['pl_orbeccen']),
        inclinationDeg: parseOptionalNumber(row['pl_orbincl']),
        argumentOfPeriapsisDeg: parseOptionalNumber(row['pl_orblper'])
      }
    };
  });

  ensureDataDir();
  writeFileSync(dataPath('exoplanets.json'), JSON.stringify(exoplanets));
  console.log(`  wrote ${exoplanets.length} exoplanets (${matched} cross-referenced to a HYG host star).`);
  return exoplanets;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

if (require.main === module) {
  fetchExoplanets().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
