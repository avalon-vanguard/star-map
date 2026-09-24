import { writeFileSync } from 'node:fs';

import { BodyRecord, OrbitalElements } from '../../src/app/shared/models/body.model';
import { SUN_STAR_ID } from '../../src/app/shared/models/star.model';
import { fetchHorizonsBody } from './lib/horizons';
import { parsePlanetMeanElements, parseSatelliteMeanElements } from '../../src/app/shared/astro/mean-elements';
import { fetchPlanetMeanElementsText, fetchSatelliteMeanElementsHtml } from './lib/mean-elements';
import { dataPath, ensureDataDir } from './lib/paths';

const HOURS_PER_DAY = 24;

interface BodySpec {
  id: string;
  name: string;
  kind: BodyRecord['kind'];
  horizonsCommand: string;
  center: string;
  parentBodyId?: string;
  /**
   * Obliquity to orbit, in degrees, where the Horizons page states none. Pluto's is from the IAU
   * WGCCRE 2015 pole (RA 132.99, Dec -6.16), 119.6 degrees: past 90, so it turns retrograde.
   */
  obliquityDeg?: number;
  /** The periapsis turns backwards; see `parseSatelliteMeanElements`. */
  apsidesRegress?: boolean;
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
  { id: 'pluto', name: 'Pluto', kind: 'dwarf', horizonsCommand: '999', center: '500@10', obliquityDeg: 119.6 },
  { id: 'moon', name: 'Moon', kind: 'moon', horizonsCommand: '301', center: '500@399', parentBodyId: 'earth' },
  { id: 'phobos', name: 'Phobos', kind: 'moon', horizonsCommand: '401', center: '500@499', parentBodyId: 'mars' },
  { id: 'deimos', name: 'Deimos', kind: 'moon', horizonsCommand: '402', center: '500@499', parentBodyId: 'mars' },
  { id: 'io', name: 'Io', kind: 'moon', horizonsCommand: '501', center: '500@599', parentBodyId: 'jupiter', apsidesRegress: true },
  { id: 'europa', name: 'Europa', kind: 'moon', horizonsCommand: '502', center: '500@599', parentBodyId: 'jupiter', apsidesRegress: true },
  { id: 'ganymede', name: 'Ganymede', kind: 'moon', horizonsCommand: '503', center: '500@599', parentBodyId: 'jupiter' },
  { id: 'callisto', name: 'Callisto', kind: 'moon', horizonsCommand: '504', center: '500@599', parentBodyId: 'jupiter' },
  { id: 'titan', name: 'Titan', kind: 'moon', horizonsCommand: '606', center: '500@699', parentBodyId: 'saturn' },
  { id: 'triton', name: 'Triton', kind: 'moon', horizonsCommand: '801', center: '500@899', parentBodyId: 'neptune' }
];

/**
 * Writes `bodies.json` for the major planets, Pluto, and a curated set of major moons: JPL's
 * mean orbital elements for where they go, and JPL Horizons for their size and spin. Horizons'
 * osculating elements for the same date come back alongside, for `build.ts` to check the mean
 * ones against.
 */
export async function fetchSolarSystem(): Promise<{ bodies: BodyRecord[]; horizonsOrbits: Map<string, OrbitalElements> }> {
  console.log(`Fetching ${BODY_SPECS.length} solar-system bodies from JPL (mean elements, Horizons)...`);
  const bodies: BodyRecord[] = [];
  const horizonsOrbits = new Map<string, OrbitalElements>();
  const planetElements = await fetchPlanetMeanElementsText();
  const satelliteElements = await fetchSatelliteMeanElementsHtml();

  for (const spec of BODY_SPECS) {
    const result = await fetchHorizonsBody({
      command: spec.horizonsCommand,
      center: spec.center,
      cacheKey: `horizons-${spec.id}.txt`
    });

    horizonsOrbits.set(spec.id, result.orbit);
    if (result.radiusKm === undefined) {
      console.warn(`  no physical radius found for ${spec.name}; defaulting to 0.`);
    }

    const parentName = BODY_SPECS.find((candidate) => candidate.id === spec.parentBodyId)?.name;
    const mean = parentName
      ? parseSatelliteMeanElements(satelliteElements, parentName, spec.name, spec.apsidesRegress ?? false)
      : parsePlanetMeanElements(planetElements, spec.id);

    // Every moon listed here is tidally locked, so its day is its orbit: the sidereal period from
    // the same mean motion that carries it round, which keeps one face towards the parent however
    // long the clock runs. Not every page says so — the Moon's gives a rate, Titan's nothing. The
    // Kepler period of the osculating orbit this used to take, 27.70 days for the Moon, would now
    // turn its face five degrees an orbit away from the orbit it is drawn on.
    const rotationPeriodHours = result.tidallyLocked || spec.kind === 'moon'
      ? (360 / mean.rates.meanMotionDegPerDay) * HOURS_PER_DAY
      : result.rotationPeriodHours;
    if (rotationPeriodHours === undefined) {
      console.warn(`  no rotation period found for ${spec.name}; it will not turn.`);
    }

    bodies.push({
      id: spec.id,
      systemStarId: SUN_STAR_ID,
      name: spec.name,
      kind: spec.kind,
      radiusKm: result.radiusKm ?? 0,
      orbit: mean.orbit,
      rates: mean.rates,
      ...(mean.laplacePole ? { laplacePole: mean.laplacePole } : {}),
      orbitSource: mean.orbitSource,
      ...(spec.parentBodyId ? { parentBodyId: spec.parentBodyId } : {}),
      ...(rotationPeriodHours !== undefined ? { rotationPeriodHours } : {}),
      ...((result.obliquityDeg ?? spec.obliquityDeg) !== undefined ? { obliquityDeg: result.obliquityDeg ?? spec.obliquityDeg } : {})
    });
  }

  ensureDataDir();
  writeFileSync(dataPath('bodies.json'), JSON.stringify(bodies, null, 2));
  console.log(`  wrote ${bodies.length} bodies.`);
  return { bodies, horizonsOrbits };
}

if (require.main === module) {
  fetchSolarSystem().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
