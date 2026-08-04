import { statSync } from 'node:fs';

import { BodyRecord } from '../../src/app/shared/models/body.model';
import { DeepSkyRecord } from '../../src/app/shared/models/deepsky.model';
import { ExoplanetRecord } from '../../src/app/shared/models/exoplanet.model';
import { StarRecord, SUN_STAR_ID } from '../../src/app/shared/models/star.model';
import { fetchDeepSky } from './fetchDeepSky';
import { fetchExoplanets } from './fetchExoplanets';
import { fetchSolarSystem } from './fetchSolarSystem';
import { fetchStars } from './fetchStars';
import { dataPath } from './lib/paths';

class ValidationError extends Error {}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new ValidationError(message);
  }
}

function validateStars(stars: StarRecord[]): void {
  assertCondition(stars.length > 0, 'No stars were produced.');

  const ids = new Set<number>();
  for (const star of stars) {
    assertCondition(Number.isFinite(star.id), `Star has a non-numeric id: ${JSON.stringify(star)}`);
    assertCondition(!ids.has(star.id), `Duplicate star id: ${star.id}`);
    ids.add(star.id);
    assertCondition(!!star.name, `Star ${star.id} has no name.`);
    assertCondition([star.x, star.y, star.z].every(Number.isFinite), `Star ${star.id} has a non-finite position.`);
  }

  const binSize = statSync(dataPath('stars.bin')).size;
  assertCondition(binSize === stars.length * 3 * 4, `stars.bin size (${binSize}) does not match ${stars.length} stars.`);
}

function validateBodies(bodies: BodyRecord[]): void {
  assertCondition(bodies.length > 0, 'No solar-system bodies were produced.');

  const ids = new Set(bodies.map((body) => body.id));
  assertCondition(ids.size === bodies.length, 'Duplicate body ids were found.');

  for (const body of bodies) {
    const orbitValues = Object.values(body.orbit);
    assertCondition(orbitValues.every(Number.isFinite), `Body ${body.id} has non-finite orbital elements.`);

    if (body.kind === 'moon') {
      assertCondition(!!body.parentBodyId && ids.has(body.parentBodyId), `Moon ${body.id} has no valid parentBodyId.`);
    }
  }

  const planetCount = bodies.filter((body) => body.kind === 'planet').length;
  assertCondition(planetCount === 8, `Expected 8 planets, found ${planetCount}.`);
}

function validateExoplanets(exoplanets: ExoplanetRecord[], starIds: Set<number>): void {
  assertCondition(exoplanets.length > 0, 'No exoplanets were produced.');

  let crossReferenced = 0;
  for (const exoplanet of exoplanets) {
    assertCondition(!!exoplanet.name, `Exoplanet ${exoplanet.id} has no name.`);
    if (exoplanet.hostStarId !== null) {
      assertCondition(starIds.has(exoplanet.hostStarId), `Exoplanet ${exoplanet.id} references unknown star id ${exoplanet.hostStarId}.`);
      // The Sun has no exoplanets, so any match to it is a matching failure — historically a
      // blank distance column parsing as 0, which puts the host at the origin and matches Sol
      // exactly. Free, permanent tripwire for that whole class of bug.
      assertCondition(
        exoplanet.hostStarId !== SUN_STAR_ID,
        `Exoplanet ${exoplanet.id} was matched to the Sun, which has no exoplanets — the host-star match is wrong.`
      );
      crossReferenced++;
    }

    assertCondition(
      exoplanet.periodDays === undefined || exoplanet.periodDays > 0,
      `Exoplanet ${exoplanet.id} has a non-positive orbital period.`
    );
    assertCondition(
      exoplanet.hostStarMassSolar === undefined || exoplanet.hostStarMassSolar > 0,
      `Exoplanet ${exoplanet.id} has a non-positive host star mass.`
    );
  }

  console.log(`  ${crossReferenced}/${exoplanets.length} exoplanets cross-referenced to a HYG host star.`);

  // How many can be propagated at their real rate rather than as if the host were the Sun.
  const withPeriod = exoplanets.filter((exoplanet) => exoplanet.periodDays !== undefined).length;
  const withHostMass = exoplanets.filter((exoplanet) => exoplanet.hostStarMassSolar !== undefined).length;
  console.log(`  ${withPeriod}/${exoplanets.length} have a measured period, ${withHostMass} a host star mass.`);
}

const UNIT_VECTOR_TOLERANCE = 1e-6;

function validateDeepSky(objects: DeepSkyRecord[]): void {
  assertCondition(objects.length > 0, 'No deep-sky objects were produced.');

  const ids = new Set<string>();
  for (const object of objects) {
    assertCondition(!!object.id, `Deep-sky object has no id: ${JSON.stringify(object)}`);
    assertCondition(!ids.has(object.id), `Duplicate deep-sky id: ${object.id}`);
    ids.add(object.id);
    assertCondition(!!object.name, `Deep-sky object ${object.id} has no name.`);

    // Positions are directions, so every one of them must be a unit vector — a zero-length
    // or mis-scaled entry would silently collapse onto the origin on the backdrop shell.
    const length = Math.hypot(object.x, object.y, object.z);
    assertCondition(Math.abs(length - 1) < UNIT_VECTOR_TOLERANCE, `Deep-sky object ${object.id} has a non-unit direction (length ${length}).`);

    assertCondition(object.angularSizeDeg >= 0, `Deep-sky object ${object.id} has a negative angular size.`);
    assertCondition(object.distancePc === null || object.distancePc > 0, `Deep-sky object ${object.id} has a non-positive distance.`);
    // The distance and its provenance have to travel together, or the UI cannot say where a
    // number came from.
    assertCondition(
      (object.distancePc === null) === (object.distanceMethod === null),
      `Deep-sky object ${object.id} has a distance/method mismatch.`
    );
  }

  const kinds = new Set(objects.map((object) => object.kind));
  for (const kind of ['galaxy', 'nebula', 'cluster'] as const) {
    assertCondition(kinds.has(kind), `No deep-sky objects of kind "${kind}" were produced.`);
  }

  const withDistance = objects.filter((object) => object.distancePc !== null).length;
  console.log(`  ${withDistance}/${objects.length} deep-sky objects have a derived distance.`);
}

/**
 * Orchestrates the whole ETL pipeline: fetches every source (each caches its own raw
 * responses under `tools/etl/.cache/`), writes the static assets under `src/assets/data/`,
 * then validates the combined output for completeness before declaring success.
 */
async function build(): Promise<void> {
  console.log('=== NASA star map ETL ===\n');

  const stars = await fetchStars();
  console.log();
  const bodies = await fetchSolarSystem();
  console.log();
  const exoplanets = await fetchExoplanets(stars);
  console.log();
  const deepSky = await fetchDeepSky();
  console.log();

  console.log('Validating output...');
  validateStars(stars);
  validateBodies(bodies);
  validateExoplanets(exoplanets, new Set(stars.map((star) => star.id)));
  validateDeepSky(deepSky);

  console.log('\nETL completed successfully:');
  console.log(`  stars:      ${stars.length}`);
  console.log(`  bodies:     ${bodies.length}`);
  console.log(`  exoplanets: ${exoplanets.length}`);
  console.log(`  deep sky:   ${deepSky.length}`);
}

build().catch((error) => {
  console.error('\nETL failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
