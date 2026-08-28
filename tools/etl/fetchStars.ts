import { writeFileSync } from 'node:fs';

import { mergeStarCatalogues } from '../../src/app/shared/astro/star-merge';
import { encodeStarCatalog } from '../../src/app/shared/models/star-catalog';
import { StarRecord, SUN_STAR_ID } from '../../src/app/shared/models/star.model';
import { positionalSources } from './sources/registry';
import { PARALLAX_PRECISION_MAS } from './sources/star-sources';
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

/**
 * Stars within this distance (parsecs) of the Sun are kept for the galaxy view.
 *
 * Set at the range HYG's own measurements reach rather than at a round number. 98.6% of its
 * rows carry a Hipparcos identifier, and Hipparcos parallaxes are good to roughly a
 * milliarcsecond — so at 250 pc (4 mas) a star's distance is uncertain by some tens of per
 * cent, and beyond it the catalogue is plotting noise. Note that only the *radial* placement
 * blurs: a star's direction on the sky stays exact at any distance.
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
 * Downloads the HYG (Hipparcos/Yale/Gliese) stellar database, takes each star's equatorial
 * Cartesian position (parsecs, epoch J2000.0), filters by distance, unions the other positional
 * sources, and writes `stars.bin` (packed positions) + `stars-index.json` (everything else).
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

    // HYG's own Cartesian columns rather than its `ra`/`dec`, which are in the same frame as
    // `raDecDistanceToXyz` and would be redundant if the two agreed. They do not, for the stars
    // that move: the right ascension was carried from the Hipparcos epoch to 2000.0 without the
    // cos δ its motion needs, which puts Proxima 17.9″ from where HYG's own x/y/z — and Gaia,
    // once brought to the same epoch — have it. 1813 stars differ by over an arcsecond, and the
    // Cartesian columns are the ones Gaia agrees with for 1155 of them against 156 (one of those,
    // HIP 57146, has x/y/z 161″ from its own ra/dec and stays double).
    const x = Number(row['x']);
    const y = Number(row['y']);
    const z = Number(row['z']);
    if (![x, y, z].every(Number.isFinite)) {
      continue;
    }

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

  console.log(`  kept ${stars.length} stars (of ${rows.length} in the catalog).`);

  const merged = await mergeWithOtherSources(stars);
  merged.sort((a, b) => a.id - b.id);
  writeStarAssets(merged);
  return merged;
}

/**
 * Unions HYG with every other positional source that is wired in and reachable.
 *
 * A source that cannot be reached is reported and skipped rather than failing the run. That is
 * not defensive padding: the archives this would draw on are frequently unavailable, and a build
 * that produces a smaller catalogue is far better than one that produces none.
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

function writeStarAssets(stars: StarRecord[]): void {
  ensureDataDir();

  // The layout lives in `star-catalog.ts`, which the app decodes with — one definition, so the
  // writer and the reader cannot drift.
  const { index, positions, meta } = encodeStarCatalog(stars);

  writeFileSync(dataPath('stars.bin'), Buffer.from(positions.buffer));
  writeFileSync(dataPath('stars-meta.bin'), Buffer.from(meta));
  writeFileSync(dataPath('stars-index.json'), JSON.stringify(index));
}

if (require.main === module) {
  fetchStars().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
