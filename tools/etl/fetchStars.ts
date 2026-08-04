import { writeFileSync } from 'node:fs';

import { raDecDistanceToXyz } from '../../src/app/shared/astro/coordinates';
import { StarRecord, SUN_STAR_ID } from '../../src/app/shared/models/star.model';
import { parseCsvObjects, parseOptionalNumber } from './lib/csv';
import { fetchTextCached } from './lib/http';
import { dataPath, ensureDataDir } from './lib/paths';

const HYG_CSV_URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const HYG_UNKNOWN_DISTANCE_PC = 100000; // HYG's placeholder for unmeasured/unreliable parallax

/**
 * Stand-in magnitude for a star with no photometry. Faint rather than 0, because 0 would mean
 * "as bright as Vega" and render it as one of the largest points on the map.
 */
const UNKNOWN_MAGNITUDE = 15;

/** Stars within this distance (parsecs) of the Sun are kept for the galaxy view. */
const DISTANCE_CUTOFF_PC = Number(process.env['ETL_STAR_DISTANCE_PC'] ?? 50);

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
 * Downloads the HYG (Hipparcos/Yale/Gliese) stellar database, converts each star's
 * RA/Dec/distance into galaxy-scale Cartesian coordinates (parsecs), filters by distance,
 * and writes `stars.bin` (packed positions) + `stars-index.json` (everything else).
 */
export async function fetchStars(): Promise<StarRecord[]> {
  console.log(`Fetching HYG star catalog (distance cutoff: ${DISTANCE_CUTOFF_PC} pc)...`);
  const csv = await fetchTextCached(HYG_CSV_URL, 'hygdata_v41.csv');
  const rows = parseCsvObjects(csv);

  const stars: StarRecord[] = [];

  for (const row of rows) {
    const id = Number(row['id']);
    const distancePc = Number(row['dist']);

    if (id === SUN_STAR_ID) {
      stars.push({ id, name: 'Sol', x: 0, y: 0, z: 0, magnitude: parseOptionalNumber(row['mag']) ?? UNKNOWN_MAGNITUDE, spectralType: row['spect'] || 'G2V', colorIndex: parseOptionalNumber(row['ci']) ?? null });
      continue;
    }

    if (!Number.isFinite(distancePc) || distancePc >= HYG_UNKNOWN_DISTANCE_PC || distancePc > DISTANCE_CUTOFF_PC) {
      continue;
    }

    const raHours = Number(row['ra']);
    const decDeg = Number(row['dec']);
    if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) {
      continue;
    }

    const { x, y, z } = raDecDistanceToXyz(raHours, decDeg, distancePc);

    stars.push({
      id,
      name: resolveName(row),
      x,
      y,
      z,
      magnitude: parseOptionalNumber(row['mag']) ?? UNKNOWN_MAGNITUDE,
      spectralType: row['spect'] || 'Unknown',
      colorIndex: parseOptionalNumber(row['ci']) ?? null
    });
  }

  stars.sort((a, b) => a.id - b.id);
  writeStarAssets(stars);

  console.log(`  kept ${stars.length} stars (of ${rows.length} in the catalog).`);
  return stars;
}

function writeStarAssets(stars: StarRecord[]): void {
  ensureDataDir();

  const positions = new Float32Array(stars.length * 3);
  stars.forEach((star, index) => {
    positions[index * 3] = star.x;
    positions[index * 3 + 1] = star.y;
    positions[index * 3 + 2] = star.z;
  });

  writeFileSync(dataPath('stars.bin'), Buffer.from(positions.buffer));
  writeFileSync(dataPath('stars-index.json'), JSON.stringify(stars));
}

if (require.main === module) {
  fetchStars().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
