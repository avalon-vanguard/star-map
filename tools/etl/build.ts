import { statSync } from 'node:fs';

import { BodyRecord } from '../../src/app/shared/models/body.model';
import { DeepSkyRecord } from '../../src/app/shared/models/deepsky.model';
import { ExoplanetRecord } from '../../src/app/shared/models/exoplanet.model';
import { StarRecord, SUN_STAR_ID } from '../../src/app/shared/models/star.model';
import { fetchDeepSky } from './fetchDeepSky';
import { fetchExoplanets } from './fetchExoplanets';
import { fetchSolarSystem } from './fetchSolarSystem';
import { BYTES_PER_STAR_META, BYTES_PER_STAR_POSITION, decodeStarCatalog, encodeStarCatalog, isDesignation } from '../../src/app/shared/models/star-catalog';
import { fetchStars, glieseGaiaDesignations } from './fetchStars';
import { ARCHIVE_EPOCH, archiveStarId, CATALOGUE_EPOCH } from '../../src/app/shared/astro/host-star-matching';
import { foldsInto } from '../../src/app/shared/astro/star-merge';
import { propagateProperMotion, raDegDecDistanceToXyz } from '../../src/app/shared/astro/coordinates';
import { describeSources } from './sources/registry';
import { dataPath } from './lib/paths';

class ValidationError extends Error {}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new ValidationError(message);
  }
}

/**
 * Stars whose magnitude is a stand-in, and distances published without an error. Measured 309 and
 * 332: the 44 Gaia sources with no G and the 265 archive hosts with neither V nor G; the 250 Gliese
 * distances (no Hipparcos parallax behind them) and 82 archive hosts the archive gives no error
 * for. Losing either field loses it for hundreds of thousands of stars.
 */
const MAX_STARS_WITHOUT_BAND = 1_000;
const MAX_STARS_WITHOUT_DISTANCE_ERROR = 1_000;
/**
 * What the errors themselves come to, which the two counts above cannot see: Gaia's parallax_error
 * stored in milliarcseconds rather than over the parallax still encodes, decodes and passes both.
 * Measured: the median relative error of the stars at Gaia's distance is 0.33 %, and 1 116 parallax
 * distances (0.24 % of the stars) have one of a fifth or more, which the card prints as a range.
 * The mistake above gives 1.92 % and 17 689.
 */
const MAX_MEDIAN_GAIA_DISTANCE_ERROR = 0.01;
const MAX_RANGED_DISTANCE_SHARE = 0.01;
/**
 * HYG stars that keep their own row but sit at Gaia's distance, which fetchStars flags for the card
 * to say "HYG, Gaia DR3 distance". Measured 8 105; the flag dropped leaves none, and nothing else
 * notices — the other 61 713 carry it from their Gaia row.
 */
const MIN_HYG_STARS_AT_GAIA_DISTANCE = 6_000;
/**
 * The other half of placing a star at its more precise distance (8c3a860): a HYG star folded into
 * its Gaia entry that keeps its Hipparcos distance, which Gaia saturates on. Measured 384, none
 * before 8c3a860, and 148 with fetchStars handing combine Gaia's error with the Hipparcos distance,
 * where the two errors tie and Gaia's distance wins — which the floor above cannot see, since that
 * raises its count to 8 129. The two stars below are what that looks like: Tarazed went back to
 * Gaia's 178.9 pc, and Eta Leo kept its 389 pc but read "±17 %, HYG, Gaia DR3 distance".
 */
const MIN_GAIA_STARS_AT_HIPPARCOS_DISTANCE = 300;
const HIPPARCOS_PLACED_STARS = [
  { id: 96970, name: 'Tarazed', distancePc: 121.07 },
  { id: 49441, name: 'Eta Leo', distancePc: 389.11 }
];
/** Their distances' errors, 2.1 % and 6.3 %, against Gaia's 6.9 % and 17 %. */
const MAX_HIPPARCOS_PLACED_ERROR = 0.065;
/**
 * Archive hosts whose colour is read off their temperature, which the card marks "from its
 * temperature" (23547de). Measured 54; the flag's write dropped from fetchExoplanets leaves none,
 * and every other check passes, since the round trip compares the flag with itself.
 */
const MIN_COLOURS_FROM_TEMPERATURE = 40;
/**
 * Archive stars numbered after their host's name (62f81f2), so a refresh keeps each one's id and a
 * bookmark its star. Measured: 3 276 of the 3 277 take the id their name hashes to, one having
 * probed past a taken one. Numbered in arrival order, as before, none do, and nothing else fails.
 */
const MAX_ARCHIVE_IDS_OFF_THEIR_NAME = 5;
/**
 * Every star the naked eye sees, kept at any distance (c64eea0): measured 8 898 of V 6.5 or
 * brighter, 1 663 of them past 250 pc. With no magnitude handed to placementDistancePc, 7 379 are
 * left and Rigel, Deneb and Alnilam are gone — and every other check passed, the HYG survivors
 * going down rather than up. HD 197770 and HD 45291 are two of the twelve only Gaia's bright
 * sources place, by position; without that lookup they are gone and the count drops by twelve,
 * which the floor alone would not see.
 *
 * HD 45951 is the one only SIMBAD's name for its Gaia source places, HYG's declination for it being
 * 31.7′ out. Placed along HYG's direction instead, every check here passed, with the star drawn
 * twice: there, and as its bare source 31.7′ away. So it is held to that source by designation.
 *
 * Twenty HYG rows of V 6.5 or brighter are still left out, for want of a distance: neither HYG nor
 * Hipparcos gives one, and Gaia DR3 has no source brighter than G 7.5 with a parallax five times
 * its error within a minute of arc, nor under the name SIMBAD gives. They are β Phe, φ Cas, χ Aur,
 * ο¹ Cen, Polis, 16 Sgr, ρ Cas, η Car, and HD 47240, 50820, 90772, 97534, 100198, 101205, 101947,
 * 129092, 151804, 185936, 202214 and 212466. A 21st, θ¹ Ori A (HYG 26155), is left out on purpose:
 * its V 4.98 and O7 are Hipparcos's for it and a companion together, and SIMBAD names it a source
 * of G 6.63 at 378 pc, which the map does not keep; placed, it was drawn brighter than θ¹ Ori C.
 */
const MIN_NAKED_EYE_STARS = 8_800;
const NAKED_EYE_MAGNITUDE_V = 6.5;
const REQUIRED_NAKED_EYE_STARS = ['Rigel', 'Deneb', 'Alnilam', 'HD 197770', 'HD 45291', 'HD 45951'];
const IDENTIFIED_NAKED_EYE_STARS = [{ name: 'HD 45951', gaiaDesignation: 'Gaia DR3 3369454521490604416' }];
const BLENDED_NAKED_EYE_ROWS = [{ id: 26155, name: 'θ¹ Ori A' }];

function validateStars(stars: StarRecord[]): void {
  assertCondition(stars.length > 0, 'No stars were produced.');

  const ids = new Set<number>();
  for (const star of stars) {
    assertCondition(Number.isFinite(star.id), `Star has a non-numeric id: ${JSON.stringify(star)}`);
    // Under 2^30, which V8 keeps unboxed; past it every id is a heap number, and the app's boot
    // task grew by 230 ms when the nearby Gaia stars were numbered from 2 000 000 000.
    assertCondition(star.id >= 0 && star.id < 2 ** 30, `Star ${star.id} has an id outside 0 to 2^30.`);
    assertCondition(!ids.has(star.id), `Duplicate star id: ${star.id}`);
    ids.add(star.id);
    assertCondition(!!star.name, `Star ${star.id} has no name.`);
    assertCondition([star.x, star.y, star.z].every(Number.isFinite), `Star ${star.id} has a non-finite position.`);
  }

  const positionBytes = statSync(dataPath('stars.bin')).size;
  assertCondition(positionBytes === stars.length * BYTES_PER_STAR_POSITION, `stars.bin size (${positionBytes}) does not match ${stars.length} stars.`);
  const metaBytes = statSync(dataPath('stars-meta.bin')).size;
  assertCondition(metaBytes === stars.length * BYTES_PER_STAR_META, `stars-meta.bin size (${metaBytes}) does not match ${stars.length} stars.`);

  // Round-trips the written assets back through the decoder the app uses, so a format change
  // that only half-lands fails here rather than as a silently wrong star map.
  const { index, positions, meta } = encodeStarCatalog(stars);
  const decoded = decodeStarCatalog(index, positions, meta);
  assertCondition(decoded.length === stars.length, `Star catalogue round-trip lost records: ${decoded.length} of ${stars.length}.`);
  for (let i = 0; i < stars.length; i++) {
    assertCondition(decoded[i].id === stars[i].id && decoded[i].name === stars[i].name, `Star catalogue round-trip altered record ${i}.`);
    assertCondition(decoded[i].spectralType === stars[i].spectralType, `Star catalogue round-trip lost the spectral type of star ${stars[i].id}.`);
    assertCondition(decoded[i].colorIndex === null === (stars[i].colorIndex === null), `Star catalogue round-trip changed whether star ${stars[i].id} has a colour index.`);
    assertCondition(
      decoded[i].magnitudeBand === stars[i].magnitudeBand &&
        decoded[i].colorSystem === stars[i].colorSystem &&
        decoded[i].distanceFromGaia === !!stars[i].distanceFromGaia &&
        decoded[i].colorFromTemperature === !!stars[i].colorFromTemperature,
      `Star catalogue round-trip changed the photometry of star ${stars[i].id}.`
    );
    // Stored as its square root in 65 535ths, up to 100 %; see `star-catalog.ts`.
    const error = stars[i].distanceError;
    assertCondition(
      error === undefined ? decoded[i].distanceError === undefined : Math.abs(Math.sqrt(decoded[i].distanceError!) - Math.sqrt(Math.min(1, error))) <= 0.5 / 65_535 + 1e-9,
      `Star catalogue round-trip changed the distance error of star ${stars[i].id}.`
    );
  }

  // What each star says it was measured in. A band or an error dropped on the way still encodes,
  // decodes and draws; it shows only as a card reading "Not measured" for a star that was.
  const withoutBand = stars.filter((star) => star.magnitudeBand === undefined).length;
  assertCondition(withoutBand <= MAX_STARS_WITHOUT_BAND, `${withoutBand} stars have no magnitude band (at most ${MAX_STARS_WITHOUT_BAND} expected) — the band is being lost.`);
  const withoutError = stars.filter((star) => star.id !== SUN_STAR_ID && star.distanceError === undefined).length;
  assertCondition(
    withoutError <= MAX_STARS_WITHOUT_DISTANCE_ERROR,
    `${withoutError} stars have no distance error (at most ${MAX_STARS_WITHOUT_DISTANCE_ERROR} expected) — the parallax errors are being lost.`
  );
  console.log(`  ${withoutBand} stars with a stand-in magnitude; ${withoutError} distances without a published error.`);

  const gaiaErrors = stars
    .filter((star) => star.distanceFromGaia && star.distanceError !== undefined)
    .map((star) => star.distanceError!)
    .sort((a, b) => a - b);
  const medianGaiaError = gaiaErrors[Math.floor(gaiaErrors.length / 2)] ?? 0;
  assertCondition(
    medianGaiaError <= MAX_MEDIAN_GAIA_DISTANCE_ERROR,
    `The median error of Gaia's distances is ${(medianGaiaError * 100).toFixed(2)} % (at most ${MAX_MEDIAN_GAIA_DISTANCE_ERROR * 100} % expected) — the parallax errors are no longer relative.`
  );
  // The archive's errors are on the distance and never printed as a range; see formatDistance.
  const ranged = stars.filter((star) => star.source !== 'exoplanet-archive' && (star.distanceError ?? 0) >= 0.2).length;
  assertCondition(
    ranged <= stars.length * MAX_RANGED_DISTANCE_SHARE,
    `${ranged} parallax distances have an error of a fifth or more (at most ${MAX_RANGED_DISTANCE_SHARE * 100} % of stars expected).`
  );
  const hygAtGaiaDistance = stars.filter((star) => star.source === 'hyg' && star.distanceFromGaia).length;
  assertCondition(
    hygAtGaiaDistance >= MIN_HYG_STARS_AT_GAIA_DISTANCE,
    `Only ${hygAtGaiaDistance} HYG stars are flagged at Gaia's distance (at least ${MIN_HYG_STARS_AT_GAIA_DISTANCE} expected) — fetchStars no longer says whose parallax it placed them by.`
  );
  console.log(
    `  Gaia distances a median ${(medianGaiaError * 100).toFixed(2)} % uncertain; ${ranged} parallax distances ranged; ${hygAtGaiaDistance} HYG stars at Gaia's distance.`
  );

  const nakedEye = stars.filter((star) => star.magnitudeBand === 'V' && star.magnitude <= NAKED_EYE_MAGNITUDE_V && star.id !== SUN_STAR_ID).length;
  assertCondition(
    nakedEye >= MIN_NAKED_EYE_STARS,
    `Only ${nakedEye} stars of V ${NAKED_EYE_MAGNITUDE_V} or brighter (at least ${MIN_NAKED_EYE_STARS} expected) — naked-eye stars are no longer kept at any distance.`
  );
  for (const name of REQUIRED_NAKED_EYE_STARS) {
    assertCondition(stars.some((star) => star.name === name), `${name} is missing — naked-eye stars are no longer kept wherever a survey places them.`);
  }
  for (const expected of IDENTIFIED_NAKED_EYE_STARS) {
    assertCondition(
      stars.some((star) => star.name === expected.name && star.gaiaDesignation === expected.gaiaDesignation),
      `${expected.name} is not on ${expected.gaiaDesignation}, the source SIMBAD names it as — it is drawn where HYG has it, beside that source.`
    );
  }
  for (const blended of BLENDED_NAKED_EYE_ROWS) {
    assertCondition(!stars.some((star) => star.id === blended.id), `${blended.name} is drawn in the V and type of Hipparcos's blend of it with a companion.`);
  }
  console.log(`  ${nakedEye} naked-eye stars.`);

  const gaiaAtHipparcosDistance = stars.filter((star) => star.source === 'gaia' && star.magnitudeBand === 'V' && !star.distanceFromGaia).length;
  assertCondition(
    gaiaAtHipparcosDistance >= MIN_GAIA_STARS_AT_HIPPARCOS_DISTANCE,
    `Only ${gaiaAtHipparcosDistance} HYG stars folded into Gaia keep their Hipparcos distance (at least ${MIN_GAIA_STARS_AT_HIPPARCOS_DISTANCE} expected) — the more precise distance no longer wins.`
  );
  for (const expected of HIPPARCOS_PLACED_STARS) {
    const star = stars.find((candidate) => candidate.id === expected.id);
    const distancePc = star && Math.hypot(star.x, star.y, star.z);
    assertCondition(
      star !== undefined && Math.abs(distancePc! / expected.distancePc - 1) < 0.01 && !star.distanceFromGaia && (star.distanceError ?? 1) < MAX_HIPPARCOS_PLACED_ERROR,
      `${expected.name} is at ${distancePc?.toFixed(1)} pc, error ${star?.distanceError}, Gaia's: ${star?.distanceFromGaia} — expected its Hipparcos ${expected.distancePc} pc and error.`
    );
  }
  const coloursFromTemperature = stars.filter((star) => star.colorFromTemperature).length;
  assertCondition(
    coloursFromTemperature >= MIN_COLOURS_FROM_TEMPERATURE,
    `Only ${coloursFromTemperature} colours are marked as read off a temperature (at least ${MIN_COLOURS_FROM_TEMPERATURE} expected) — fetchExoplanets no longer says so.`
  );
  const archiveStars = stars.filter((star) => star.source === 'exoplanet-archive');
  const offTheirName = archiveStars.filter((star) => star.id !== archiveStarId(star.name, new Set())).length;
  assertCondition(
    offTheirName <= MAX_ARCHIVE_IDS_OFF_THEIR_NAME,
    `${offTheirName} of the ${archiveStars.length} archive stars have an id other than their name's (at most ${MAX_ARCHIVE_IDS_OFF_THEIR_NAME} expected) — a refresh would renumber them.`
  );
  console.log(
    `  ${gaiaAtHipparcosDistance} Gaia stars at their Hipparcos distance; ${coloursFromTemperature} colours from a temperature; ${offTheirName} archive ids off their name.`
  );


  // Hipparcos's mark on a classification it does not print in full reached the card as "Spectral
  // type A0m...", for Sirius and 2 126 other stars, which reads as text the app cut short.
  const dotted = stars.filter((star) => star.spectralType.endsWith('...')).length;
  assertCondition(dotted === 0, `${dotted} spectral types end in "..." — fetchStars no longer trims Hipparcos's mark from them.`);
}

/**
 * What a good merge looks like, in two numbers the unit suite cannot see.
 *
 * The catalogues are regenerated by a scheduled job that pushes straight to `main` once the unit
 * tests and a production build pass — and both passed, for weeks, on a catalogue carrying 23 000
 * stars twice: the suite tests code against fixtures, and no fixture is 400 000 real stars. The
 * two ways the merge has actually failed both show up here.
 *
 * A star kept twice leaves its two entries near each other on the sky, from *different* sources —
 * one catalogue does not list a star twice. Under an arcsecond that is never two stars at this
 * depth, so every such pair is a miss. Twenty-two survive today; the nineteen first counted were
 * all a second HYG row wanting a Gaia entry that already absorbed one (Gliese lists some doubles
 * twice), and the merge that trusted a Hipparcos parallax over direction left 1 112.
 *
 * The other failure leaves no close pair at all, because proper motion had already carried the
 * two entries tens of arcseconds apart — the 2026-08-24 refresh, where HYG sat at epoch 2000.0
 * and Gaia at J2016.0. What it does leave is HYG rows that found no counterpart: 36 056 of them
 * against the 11 465 today, and no counterpart was possible for most of those. 8 308 of them are
 * every star beyond 250 pc but the archive's planet hosts, which the main query never downloads: 1 661
 * naked-eye stars kept at any distance, and 6 647 fainter ones that Hipparcos put inside
 * `ETL_STAR_DISTANCE_PC` while Gaia's parallax puts them past `ETL_GAIA_DISTANCE_PC`. The other
 * 3 156 are what Gaia genuinely lacks: 1 202 brighter than V 8, which it saturates on or measures
 * poorly, 1 793 between 8 and 12, and 161 fainter, 111 of them Gliese stars within 50 pc that
 * neither of its queries holds. So the headroom left to the ceiling tracks the gap between those two cutoffs as
 * much as Gaia's completeness.
 *
 * This bounds a merge that went wrong, and — loosely — a Gaia download that came back short: a
 * truncated answer leaves the HYG rows whose counterpart it dropped without one, so survivors go
 * *up*, not down. Measured on the main query when it was the only one, with 10 886 survivors
 * against today's 11 465: 11 004 at nine tenths of its rows, 12 711 at half, 16 258 at a third. So
 * this ceiling only catches a deep truncation, and `fetchGaiaStars` catches the shallower ones
 * with a row floor on each query.
 */
const MAX_UNMERGED_TWINS = 100;
/**
 * Gliese-only rows beside the Gaia entry SIMBAD names as the same star, which no geometry saw:
 * 49 beside a bare one before `foldByIdentity`, two of them false stars inside 10 pc (GJ 2097 at
 * 6.41 pc and GJ 4285 at 6.80, which Gaia has at 24.47 and 28.25), and 10 beside one a Hipparcos row
 * already described, Gl 251 at 5.76 pc beside HD 265866. The twin count above does not see them,
 * being up to minutes of arc apart.
 *
 * That count takes SIMBAD's map from the function the fold takes it from, so a slip in the map
 * turns both off together: with it empty, GJ 2097 and GJ 4285 were back inside 10 pc and the count
 * read none. These are checked by name and distance instead.
 */
const MAX_GLIESE_ROWS_BESIDE_THEIR_GAIA_SOURCE = 0;
const FOLDED_GLIESE_STARS = [
  { name: 'GJ 2097', beyondPc: 20 },
  { name: 'GJ 4285', beyondPc: 20 }
];
/** Gliese-only rows of stars HYG also lists by their Hipparcos row, HD 265866 and HD 304043. */
const ABSORBED_GLIESE_ROWS = ['Gl 251', 'Gl 422'];
const MAX_HYG_SURVIVORS = 15_000;
const TWIN_TOLERANCE_RAD = (1 / 3600) * (Math.PI / 180);

function validateMerge(stars: StarRecord[], gaiaDesignationById: ReadonlyMap<number, string>): void {
  // Checked first and on its own: an unreachable Gaia is skipped rather than thrown, and would
  // otherwise surface below as "68 000 HYG stars found no counterpart" — true, and no help.
  assertCondition(
    stars.some((star) => star.source === 'gaia'),
    'Gaia DR3 contributed no stars — the archive was unreachable or returned nothing, and a catalogue without it is not one to publish.'
  );
  const survivors = stars.filter((star) => star.source === 'hyg').length;
  assertCondition(
    survivors <= MAX_HYG_SURVIVORS,
    `${survivors} HYG stars found no Gaia counterpart (at most ${MAX_HYG_SURVIVORS} expected) — the two catalogues are not being matched.`
  );

  // Sorted by declination, so each star is only compared against the handful sharing its
  // parallel — an arcsecond of declination holds one or two of 400 000 stars.
  const byDec = stars
    .map((star) => {
      const distance = Math.hypot(star.x, star.y, star.z);
      return { star, distance, dec: distance === 0 ? 0 : Math.asin(Math.max(-1, Math.min(1, star.z / distance))) };
    })
    .filter((entry) => entry.distance > 0)
    .sort((a, b) => a.dec - b.dec);

  const cosTolerance = Math.cos(TWIN_TOLERANCE_RAD);
  let twins = 0;
  let example = '';
  for (let i = 0; i < byDec.length; i++) {
    const a = byDec[i];
    for (let j = i + 1; j < byDec.length && byDec[j].dec - a.dec <= TWIN_TOLERANCE_RAD; j++) {
      const b = byDec[j];
      if (a.star.source === b.star.source) {
        continue;
      }
      const cosine = (a.star.x * b.star.x + a.star.y * b.star.y + a.star.z * b.star.z) / (a.distance * b.distance);
      if (cosine >= cosTolerance) {
        twins++;
        example ||= `${a.star.name} (${a.star.source}) and ${b.star.name} (${b.star.source})`;
      }
    }
  }
  assertCondition(
    twins <= MAX_UNMERGED_TWINS,
    `${twins} stars from different catalogues sit within an arcsecond of each other (at most ${MAX_UNMERGED_TWINS} expected), starting with ${example} — the merge is keeping the same star twice.`
  );
  const byDesignation = new Map(stars.filter((star) => star.gaiaDesignation !== undefined).map((star) => [star.gaiaDesignation!, star]));
  const beside = stars.filter((star) => {
    const target = star.source === 'hyg' && star.distanceError === undefined ? byDesignation.get(gaiaDesignationById.get(star.id) ?? '') : undefined;
    return target !== undefined && foldsInto(target, star);
  });
  assertCondition(
    beside.length <= MAX_GLIESE_ROWS_BESIDE_THEIR_GAIA_SOURCE,
    `${beside.length} Gliese stars are drawn beside the Gaia source SIMBAD names them as, starting with ${beside[0]?.name} — the identity fold is not being made.`
  );
  for (const expected of FOLDED_GLIESE_STARS) {
    const star = stars.find((candidate) => candidate.name === expected.name);
    const distancePc = star && Math.hypot(star.x, star.y, star.z);
    assertCondition(
      distancePc !== undefined && distancePc > expected.beyondPc,
      `${expected.name} is at ${distancePc?.toFixed(2)} pc, not beyond ${expected.beyondPc} where Gaia measures it — Gliese stars are no longer folded into their Gaia source.`
    );
  }
  for (const name of ABSORBED_GLIESE_ROWS) {
    assertCondition(!stars.some((star) => star.name === name), `${name} is drawn beside the Hipparcos star it is — Gliese stars are no longer folded into their Gaia source.`);
  }
  console.log(`  ${survivors} HYG stars have no Gaia counterpart; ${twins} unmerged cross-catalogue pairs within an arcsecond; ${beside.length} Gliese stars beside their own Gaia source.`);
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

/**
 * The share of planets that must have a star on the map: 6 327 of 6 354 did when the ETL began
 * adding the hosts the catalogue lacks from the archive's own figures, up from 2 071, and 6 328
 * once a blank sy_dist gave way to the parallax (mu2 Sco b). The other 26 have neither a distance
 * nor a parallax in either archive table, so nothing can place them; the floor leaves room
 * for a few more of those, not for the matching or the additions to stop working.
 */
const MIN_HOSTED_SHARE = 0.995;
/**
 * Planets whose host only one path places, which the share above has room to lose: mu2 Sco b's
 * archive rows give a parallax and no distance, and without the parallax it had no star — 6 327
 * hosted instead of 6 328, and every check passed.
 */
const REQUIRED_HOSTED_PLANETS = ['mu2 Sco b'];
/**
 * Two hosts' luminosities as the archive gives them, one either side of the Sun's: st_lum −2.821
 * for Proxima (Ribas et al. 2017 measure 1.51×10⁻³ L☉) and +1.602 for HD 97048. That every
 * luminosity is positive catches st_lum stored unconverted and nothing else: read as 10^−x or e^x,
 * Proxima came out 662 or 0.0595 L☉ and every check passed.
 */
const LUMINOSITY_ANCHORS = [
  { planet: 'Proxima Cen b', luminositySolar: 1.51e-3 },
  { planet: 'HD 97048 b', luminositySolar: 40 }
];
const LUMINOSITY_ANCHOR_TOLERANCE = 0.1;

/**
 * The share of planets whose host's radius and temperature the archive gives, which is what
 * starSurfaceOf draws a host with before deriving one. Measured 6 030 and 6 054 of 6 354 (0.95).
 * Both come from the composite table only; a column lost on the way leaves every host derived —
 * Proxima 0.105 R☉ instead of 0.141 — and nothing else fails.
 */
const MIN_HOST_SURFACE_SHARE = 0.9;
/**
 * How far, in milliarcseconds, a star placed from the archive may sit from its planets' published
 * position carried from the archive's epoch to the catalogue's. Measured 0.0001 at most, rounding;
 * carried from J2016 instead, TOI-2406 moves 203 mas and 2 287 archive stars more than 1.
 */
const MAX_ARCHIVE_EPOCH_OFFSET_MAS = 1;

function validateExoplanets(exoplanets: ExoplanetRecord[], stars: StarRecord[]): void {
  assertCondition(exoplanets.length > 0, 'No exoplanets were produced.');
  const starsById = new Map(stars.map((star) => [star.id, star]));

  let crossReferenced = 0;
  for (const exoplanet of exoplanets) {
    assertCondition(!!exoplanet.name, `Exoplanet ${exoplanet.id} has no name.`);
    if (exoplanet.hostStarId !== null) {
      const host = starsById.get(exoplanet.hostStarId);
      assertCondition(host !== undefined, `Exoplanet ${exoplanet.id} references unknown star id ${exoplanet.hostStarId}.`);
      // A host known only as "Gaia DR3 2635476908753563008" cannot be found by searching for
      // TRAPPIST-1; fetchExoplanets names it after its host, and 574 were renamed.
      assertCondition(!isDesignation(host!), `Exoplanet ${exoplanet.id}'s host is only a designation, ${host!.name}, not named after ${exoplanet.hostStarName}.`);
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

  console.log(`  ${crossReferenced}/${exoplanets.length} exoplanets have a host star on the map.`);
  assertCondition(
    crossReferenced >= exoplanets.length * MIN_HOSTED_SHARE,
    `Only ${crossReferenced} of ${exoplanets.length} exoplanets have a host star (at least ${MIN_HOSTED_SHARE * 100} % expected) — hosts are no longer being matched or added.`
  );
  for (const name of REQUIRED_HOSTED_PLANETS) {
    const planet = exoplanets.find((candidate) => candidate.name === name);
    assertCondition(planet?.hostStarId != null, `${name} has no host star — a host the archive places by its parallax alone is no longer placed.`);
  }

  const withRadius = exoplanets.filter((exoplanet) => exoplanet.hostStarRadiusSolar !== undefined).length;
  const withTemperature = exoplanets.filter((exoplanet) => exoplanet.hostStarTemperatureK !== undefined).length;
  assertCondition(
    Math.min(withRadius, withTemperature) >= exoplanets.length * MIN_HOST_SURFACE_SHARE,
    `Only ${withRadius} of ${exoplanets.length} exoplanets carry their host's radius and ${withTemperature} its temperature (at least ${MIN_HOST_SURFACE_SHARE * 100} % expected) — st_rad or st_teff is being lost.`
  );
  // Since d94451e st_lum warms the planets of 4 441 hosts and is what their cards print; lost, each
  // falls back to a derived luminosity, 757 of them more than 1.5 times off it. Measured 6 036.
  const luminosities = exoplanets.map((exoplanet) => exoplanet.hostStarLuminositySolar).filter((luminosity) => luminosity !== undefined);
  assertCondition(
    luminosities.length >= exoplanets.length * MIN_HOST_SURFACE_SHARE,
    `Only ${luminosities.length} of ${exoplanets.length} exoplanets carry their host's luminosity (at least ${MIN_HOST_SURFACE_SHARE * 100} % expected) — st_lum is being lost.`
  );
  // Published as a logarithm, most of them negative: stored unconverted, they would not be.
  assertCondition(
    luminosities.every((luminosity) => Number.isFinite(luminosity) && luminosity! > 0),
    'A host luminosity is not a positive number — st_lum is no longer converted from its logarithm.'
  );
  for (const anchor of LUMINOSITY_ANCHORS) {
    const luminosity = exoplanets.find((exoplanet) => exoplanet.name === anchor.planet)?.hostStarLuminositySolar;
    assertCondition(
      luminosity !== undefined && Math.abs(luminosity / anchor.luminositySolar - 1) <= LUMINOSITY_ANCHOR_TOLERANCE,
      `${anchor.planet}'s host is ${luminosity} L☉, not the ${anchor.luminositySolar} its st_lum gives — st_lum is not being read as the base-10 logarithm it is.`
    );
  }
  console.log(`  ${withRadius}/${exoplanets.length} carry their host's radius, ${withTemperature} its temperature, ${luminosities.length} its luminosity.`);

  let worstOffsetMas = 0;
  for (const star of stars.filter((candidate) => candidate.source === 'exoplanet-archive')) {
    const planet = exoplanets.find((candidate) => candidate.hostStarId === star.id)!;
    const at = propagateProperMotion(planet.hostRaDeg!, planet.hostDecDeg!, planet.hostPmRaMasPerYear ?? 0, planet.hostPmDecMasPerYear ?? 0, CATALOGUE_EPOCH - ARCHIVE_EPOCH);
    const expected = raDegDecDistanceToXyz(at.raDeg, at.decDeg, 1);
    const length = Math.hypot(star.x, star.y, star.z);
    // The chord between the two directions, which unlike an arccosine resolves a milliarcsecond.
    const chord = Math.hypot(star.x / length - expected.x, star.y / length - expected.y, star.z / length - expected.z);
    worstOffsetMas = Math.max(worstOffsetMas, (chord * 180 * 3_600_000) / Math.PI);
  }
  assertCondition(
    worstOffsetMas <= MAX_ARCHIVE_EPOCH_OFFSET_MAS,
    `A star placed from the archive sits ${worstOffsetMas.toFixed(1)} mas from its published position carried to J2000 (at most ${MAX_ARCHIVE_EPOCH_OFFSET_MAS} expected) — it is carried from another epoch.`
  );
  console.log(`  Stars placed from the archive at most ${worstOffsetMas.toExponential(1)} mas from their published position carried to J2000.`);

  // How many can be propagated at their real rate rather than as if the host were the Sun.
  const withPeriod = exoplanets.filter((exoplanet) => exoplanet.periodDays !== undefined).length;
  const withHostMass = exoplanets.filter((exoplanet) => exoplanet.hostStarMassSolar !== undefined).length;
  console.log(`  ${withPeriod}/${exoplanets.length} have a measured period, ${withHostMass} a host star mass.`);
}

const UNIT_VECTOR_TOLERANCE = 1e-6;

/**
 * Objects the backdrop cannot ship without, two from each of OpenNGC's files: the Andromeda
 * Galaxy and the Small Magellanic Cloud from NGC.csv, the Large Magellanic Cloud and the
 * Pleiades from addendum.csv. The addendum went unread for as long as the ETL has existed,
 * because 463 objects without the brightest deep-sky object in the sky validated cleanly.
 */
const REQUIRED_DEEP_SKY_IDS = ['NGC0224', 'NGC0292', 'ESO056-115', 'Mel022'];
/**
 * 107 of the 110 Messier objects. OpenNGC types the other three as what they are: M40 a double
 * star, M73 an asterism and M102 a duplicate of M101, none of them a deep-sky object to draw.
 */
const MIN_MESSIER_OBJECTS = 107;

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

  for (const id of REQUIRED_DEEP_SKY_IDS) {
    assertCondition(ids.has(id), `Deep-sky object ${id} is missing — one of OpenNGC's two files was not read.`);
  }
  const messier = new Set(objects.map((object) => object.messier).filter((designation) => designation !== null)).size;
  assertCondition(messier >= MIN_MESSIER_OBJECTS, `Only ${messier} Messier objects were produced (at least ${MIN_MESSIER_OBJECTS} expected).`);

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
  console.log('Catalogues:');
  console.log(describeSources());
  console.log();

  const catalogueStars = await fetchStars();
  console.log();
  const bodies = await fetchSolarSystem();
  console.log();
  // Adds the hosts the catalogue lacks, so it is this list, not the one above, that is published.
  const { exoplanets, stars } = await fetchExoplanets(catalogueStars);
  console.log();
  const deepSky = await fetchDeepSky();
  console.log();

  console.log('Validating output...');
  validateStars(stars);
  validateMerge(stars, await glieseGaiaDesignations());
  validateBodies(bodies);
  validateExoplanets(exoplanets, stars);
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
