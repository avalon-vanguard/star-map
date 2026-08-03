import { writeFileSync } from 'node:fs';

import { BodyRecord } from '../../src/app/shared/models/body.model';
import { SUN_STAR_ID } from '../../src/app/shared/models/star.model';
import { fetchHorizonsBody } from './lib/horizons';
import { dataPath, ensureDataDir } from './lib/paths';

interface BodySpec {
  id: string;
  name: string;
  kind: BodyRecord['kind'];
  horizonsCommand: string;
  center: string;
  parentBodyId?: string;
}

// Sun-centered planets/dwarf, then their major moons (planetocentric elements).
const BODY_SPECS: BodySpec[] = [
  { id: 'mercury', name: 'Mercury', kind: 'planet', horizonsCommand: '199', center: '500@10' },
  { id: 'venus', name: 'Venus', kind: 'planet', horizonsCommand: '299', center: '500@10' },
  { id: 'earth', name: 'Earth', kind: 'planet', horizonsCommand: '399', center: '500@10' },
  { id: 'mars', name: 'Mars', kind: 'planet', horizonsCommand: '499', center: '500@10' },
  { id: 'jupiter', name: 'Jupiter', kind: 'planet', horizonsCommand: '599', center: '500@10' },
  { id: 'saturn', name: 'Saturn', kind: 'planet', horizonsCommand: '699', center: '500@10' },
  { id: 'uranus', name: 'Uranus', kind: 'planet', horizonsCommand: '799', center: '500@10' },
  { id: 'neptune', name: 'Neptune', kind: 'planet', horizonsCommand: '899', center: '500@10' },
  { id: 'pluto', name: 'Pluto', kind: 'dwarf', horizonsCommand: '999', center: '500@10' },
  { id: 'moon', name: 'Moon', kind: 'moon', horizonsCommand: '301', center: '500@399', parentBodyId: 'earth' },
  { id: 'phobos', name: 'Phobos', kind: 'moon', horizonsCommand: '401', center: '500@499', parentBodyId: 'mars' },
  { id: 'deimos', name: 'Deimos', kind: 'moon', horizonsCommand: '402', center: '500@499', parentBodyId: 'mars' },
  { id: 'io', name: 'Io', kind: 'moon', horizonsCommand: '501', center: '500@599', parentBodyId: 'jupiter' },
  { id: 'europa', name: 'Europa', kind: 'moon', horizonsCommand: '502', center: '500@599', parentBodyId: 'jupiter' },
  { id: 'ganymede', name: 'Ganymede', kind: 'moon', horizonsCommand: '503', center: '500@599', parentBodyId: 'jupiter' },
  { id: 'callisto', name: 'Callisto', kind: 'moon', horizonsCommand: '504', center: '500@599', parentBodyId: 'jupiter' },
  { id: 'titan', name: 'Titan', kind: 'moon', horizonsCommand: '606', center: '500@699', parentBodyId: 'saturn' },
  { id: 'triton', name: 'Triton', kind: 'moon', horizonsCommand: '801', center: '500@899', parentBodyId: 'neptune' }
];

/**
 * Queries JPL Horizons for the osculating orbital elements (and mean radius, where
 * reported) of the major planets, Pluto, and a curated set of major moons, and writes
 * `bodies.json`.
 */
export async function fetchSolarSystem(): Promise<BodyRecord[]> {
  console.log(`Fetching ${BODY_SPECS.length} solar-system bodies from JPL Horizons...`);
  const bodies: BodyRecord[] = [];

  for (const spec of BODY_SPECS) {
    const result = await fetchHorizonsBody({
      command: spec.horizonsCommand,
      center: spec.center,
      cacheKey: `horizons-${spec.id}.txt`
    });

    if (result.radiusKm === undefined) {
      console.warn(`  no physical radius found for ${spec.name}; defaulting to 0.`);
    }

    bodies.push({
      id: spec.id,
      systemStarId: SUN_STAR_ID,
      name: spec.name,
      kind: spec.kind,
      radiusKm: result.radiusKm ?? 0,
      orbit: result.orbit,
      ...(spec.parentBodyId ? { parentBodyId: spec.parentBodyId } : {})
    });
  }

  ensureDataDir();
  writeFileSync(dataPath('bodies.json'), JSON.stringify(bodies, null, 2));
  console.log(`  wrote ${bodies.length} bodies.`);
  return bodies;
}

if (require.main === module) {
  fetchSolarSystem().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
