import { writeFileSync } from 'node:fs';

import { BodyRecord, OrbitalElements } from '../../src/app/shared/models/body.model';
import { SUN_STAR_ID } from '../../src/app/shared/models/star.model';
import { fetchHorizonsBody, fetchHorizonsTrack, TRACK_START_YEAR, TRACK_STOP_YEAR, TrackPoint } from './lib/horizons';
import { eclipticToEquatorial, laplacePlaneToEquatorial } from '../../src/app/shared/astro/coordinates';
import { meanElementsAt, positionAtEpoch } from '../../src/app/shared/astro/kepler';
import { MeanOrbit, parsePlanetMeanElements, parseSatelliteMeanElements, parseSmallBodyElements } from '../../src/app/shared/astro/mean-elements';
import { fetchPlanetMeanElementsText, fetchSatelliteMeanElementsHtml, fetchSmallBodyAnswer } from './lib/mean-elements';
import { MIN_PERIODIC_TERM_DEG, orbitalTermsOfPrimeMeridian, parsePckRotationalElements, SUN_ROTATIONAL_ELEMENTS } from '../../src/app/shared/astro/rotational-elements';
import { fetchPckText } from './lib/pck';
import { lockedToOrbit } from './lib/locked-spin';
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
  /** The pole of the planet's equator, where JPL gives its moons against that plane. */
  equatorPole?: { raDeg: number; decDeg: number };
  /** The Small-Body Database's name for a dwarf planet past Standish's tables: its orbit comes from there. */
  sbdb?: string;
  /** A measured mean radius, in km, for a body neither Horizons nor the SBDB gives one for. */
  radiusKm?: number;
  /** A triaxial body's semi-axes, in km, largest first, where its card should give its shape; see `BodyRecord.semiAxesKm`. */
  semiAxesKm?: [number, number, number];
  /** A measured sidereal day, in hours, where a later measurement overturns the one its source gives. */
  rotationPeriodHours?: number;
  /** The eccentricity for the card, where the row the orbit is drawn from gives an outdated one; see `BodyRecord.measuredEccentricity`. */
  measuredEccentricity?: number;
  /** A moon that does not keep one face to its planet: its page's own spin, or none, is kept. */
  spinsFreely?: boolean;
  /** A moon heavy enough to move its planet round their barycentre visibly; see `BodyRecord.massRatio`. */
  barycentric?: boolean;
  /**
   * Corrections to a row of the satellite table, each where the row disagrees with JPL's own
   * Horizons ephemeris and the reason is known; see the specs that carry them.
   */
  nodeOffsetDeg?: number;
  epochJd?: number;
  periodDays?: number;
  /**
   * The terms of the IAU's W that are this locked moon's motion along its orbit, which its row has
   * no column for: W's quadratic, and the term whose angle turns at `angleRateDegPerCentury`, if
   * given. See `orbitalTermsOfPrimeMeridian`.
   */
  orbitFromW?: { angleRateDegPerCentury?: number };
  /** A locked moon whose pole is carried round with its orbit's, as Iapetus's; see `lockedToOrbit`. */
  poleFollowsOrbit?: boolean;
  /**
   * Days between the Horizons positions the orbit is checked against from 1950 to 2100; 2 unless
   * the error changes faster than that. Nereid, at an eccentricity of 0.75, sweeps through its
   * periapsis, where the mean ellipse is furthest out, in days; Hyperion, on a row whose
   * eccentricity is a quarter of its real one, peaks within a day too (22.23 degrees sampled daily
   * where every other day gave 22.14).
   */
  trackStepDays?: number;
}

/** S5 in pck00011.tpc, 316.45 + 506.2 T: the libration of Mimas and Tethys in their 4:2 resonance. */
const MIMAS_TETHYS_LIBRATION = { angleRateDegPerCentury: 506.2 };

/**
 * The poles of the equators JPL refers Uranus's and Pluto's moons to, from the IAU WGCCRE 2015
 * report, each taken at the end the table's inclinations are measured from (Titania 0.079
 * degrees, Charon 0.080): the end the moons go round anticlockwise. For Pluto that is the pole
 * the IAU gives, 132.993 / -6.163, which for dwarf planets follows the right-hand rule. For
 * Uranus the IAU gives the other end, 257.311 / -15.175, named north because it lies on the
 * ecliptic's north side; the table measures inclinations from 77.311 / 15.175 but counts its
 * nodes from where the equator rises through the ICRF equator going round the IAU's pole, which
 * is 180 degrees from where it rises going round this one: hence Uranus's moons' 180-degree node
 * offset. Read with this pole and no offset, Ariel was 180 degrees from Horizons at every date
 * from 1980 to 2100; read against the IAU's pole, anywhere from 1 to 179.
 */
const URANUS_EQUATOR_POLE = { raDeg: 77.311, decDeg: 15.175 };
const PLUTO_EQUATOR_POLE = { raDeg: 132.993, decDeg: -6.163 };
const URANUS_MOON = { kind: 'moon', center: '500@799', parentBodyId: 'uranus', equatorPole: URANUS_EQUATOR_POLE, nodeOffsetDeg: 180 } as const;

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
  { id: 'ceres', name: 'Ceres', kind: 'dwarf', horizonsCommand: '1;', center: '500@10', sbdb: 'Ceres' },
  // Eris, Haumea and Makemake have no radius in the SBDB, the Horizons pages ("RAD= n.a.") or the
  // IAU WGCCRE 2015 report, so each carries its stellar-occultation measurement. Eris: 1163 km,
  // Sicardy et al. 2011 (Nature 478, 493). Haumea is triaxial, 1161 x 852 x 513 km, Ortiz et al.
  // 2017 (Nature 550, 219); drawn as a sphere, at the radius of the sphere of the same volume.
  // Makemake: 1434 km across its equator and 1422 across its projected pole, Brown 2013 (ApJ 767,
  // L7); the same mean.
  //
  // Eris's day is not the SBDB's 25.9 hours, a light curve of partial coverage (Roe et al. 2008) the
  // SBDB itself flags as "may be wrong by 30 percent or so": it turns once in 15.771 +/- 0.008 days
  // (Bernstein et al. 2023, PSJ 4, 115), locked to Dysnomia's 15.786-day orbit (Szakáts et al.
  // 2023, A&A 669, L3). On the SBDB's figure it turned 14.6 times too fast.
  //
  // Makemake's day, the SBDB's 22.83 hours, carries the same flag and is not settled either: it is
  // the double-peaked reading Hromakina et al. 2019 (A&A 625, A46) give as "possible" of a light
  // curve that repeats every 11.4 hours. Kiss et al. 2024 (ApJL, arXiv:2410.22544) find that 11.40
  // +/- 0.08 hour single peak again with TESS and Gaia, cannot confirm the 22.8, and take 11.4 as
  // their default. Neither overturns the other; the SBDB's 22.83 is kept, and may be twice the day.
  { id: 'eris', name: 'Eris', kind: 'dwarf', horizonsCommand: '136199;', center: '500@10', sbdb: 'Eris', radiusKm: 1163, rotationPeriodHours: 15.771 * 24 },
  { id: 'haumea', name: 'Haumea', kind: 'dwarf', horizonsCommand: '136108;', center: '500@10', sbdb: 'Haumea', radiusKm: 797.6, semiAxesKm: [1161, 852, 513] },
  { id: 'makemake', name: 'Makemake', kind: 'dwarf', horizonsCommand: '136472;', center: '500@10', sbdb: 'Makemake', radiusKm: 715 },
  { id: 'moon', name: 'Moon', kind: 'moon', horizonsCommand: '301', center: '500@399', parentBodyId: 'earth' },
  { id: 'phobos', name: 'Phobos', kind: 'moon', horizonsCommand: '401', center: '500@499', parentBodyId: 'mars', orbitFromW: {} },
  { id: 'deimos', name: 'Deimos', kind: 'moon', horizonsCommand: '402', center: '500@499', parentBodyId: 'mars' },
  { id: 'io', name: 'Io', kind: 'moon', horizonsCommand: '501', center: '500@599', parentBodyId: 'jupiter', apsidesRegress: true },
  { id: 'europa', name: 'Europa', kind: 'moon', horizonsCommand: '502', center: '500@599', parentBodyId: 'jupiter', apsidesRegress: true },
  { id: 'ganymede', name: 'Ganymede', kind: 'moon', horizonsCommand: '503', center: '500@599', parentBodyId: 'jupiter' },
  { id: 'callisto', name: 'Callisto', kind: 'moon', horizonsCommand: '504', center: '500@599', parentBodyId: 'jupiter' },
  { id: 'mimas', name: 'Mimas', kind: 'moon', horizonsCommand: '601', center: '500@699', parentBodyId: 'saturn', orbitFromW: MIMAS_TETHYS_LIBRATION },
  { id: 'enceladus', name: 'Enceladus', kind: 'moon', horizonsCommand: '602', center: '500@699', parentBodyId: 'saturn' },
  { id: 'tethys', name: 'Tethys', kind: 'moon', horizonsCommand: '603', center: '500@699', parentBodyId: 'saturn', orbitFromW: MIMAS_TETHYS_LIBRATION },
  { id: 'dione', name: 'Dione', kind: 'moon', horizonsCommand: '604', center: '500@699', parentBodyId: 'saturn' },
  { id: 'rhea', name: 'Rhea', kind: 'moon', horizonsCommand: '605', center: '500@699', parentBodyId: 'saturn' },
  { id: 'titan', name: 'Titan', kind: 'moon', horizonsCommand: '606', center: '500@699', parentBodyId: 'saturn' },
  // Hyperion tumbles ("Rotational period = Chaotic") and Phoebe, captured, turns in 9.27 hours.
  // Hyperion's eccentricity is 0.105 in JPL's current table (ssd.jpl.nasa.gov/sats/elem, SAT441).
  { id: 'hyperion', name: 'Hyperion', kind: 'moon', horizonsCommand: '607', center: '500@699', parentBodyId: 'saturn', spinsFreely: true, measuredEccentricity: 0.105, trackStepDays: 1 },
  { id: 'iapetus', name: 'Iapetus', kind: 'moon', horizonsCommand: '608', center: '500@699', parentBodyId: 'saturn', poleFollowsOrbit: true },
  // Phoebe's row gives a mean motion of 0.6569114 degrees a day, a 548.02-day year, where its
  // Horizons page and JPL's current table (SAT441) give 550.30: the table's own note warns that
  // its source misstated the mean motions of retrograde moons. On the row's figure Phoebe was
  // 25 degrees from Horizons by 2025 and 100 by 2075; on the current period, within 2.6 from 1950
  // to 2100 (2.58 in 1969).
  { id: 'phoebe', name: 'Phoebe', kind: 'moon', horizonsCommand: '609', center: '500@699', parentBodyId: 'saturn', spinsFreely: true, periodDays: 550.30391 },
  { id: 'miranda', name: 'Miranda', horizonsCommand: '705', ...URANUS_MOON },
  { id: 'ariel', name: 'Ariel', horizonsCommand: '701', ...URANUS_MOON },
  { id: 'umbriel', name: 'Umbriel', horizonsCommand: '702', ...URANUS_MOON },
  { id: 'titania', name: 'Titania', horizonsCommand: '703', ...URANUS_MOON },
  { id: 'oberon', name: 'Oberon', horizonsCommand: '704', ...URANUS_MOON },
  { id: 'triton', name: 'Triton', kind: 'moon', horizonsCommand: '801', center: '500@899', parentBodyId: 'neptune' },
  // Nereid's eccentric orbit, 0.75, cannot hold a face to Neptune. Its page states no spin, but
  // Kepler's K2 light curve gives 11.594 +/- 0.017 hours, confirming the short periods measured
  // from the ground (Kiss et al. 2016, MNRAS 457, 2908; arXiv:1601.02395). No pole is known.
  { id: 'nereid', name: 'Nereid', kind: 'moon', horizonsCommand: '802', center: '500@899', parentBodyId: 'neptune', spinsFreely: true, rotationPeriodHours: 11.594, trackStepDays: 1 },
  { id: 'proteus', name: 'Proteus', kind: 'moon', horizonsCommand: '808', center: '500@899', parentBodyId: 'neptune' },
  // Pluto's section prints its epoch as 2000 Jan 1.0; JPL's current table gives Charon's as
  // 2000-01-01.5, and read at 1.0 Charon sat 27.8 to 28.2 degrees — half a day of its motion is
  // 28.2 — from Horizons at every date from 1980 to 2100. At 1.5 it is within 0.4.
  { id: 'charon', name: 'Charon', kind: 'moon', horizonsCommand: '901', center: '500@999', parentBodyId: 'pluto', equatorPole: PLUTO_EQUATOR_POLE, epochJd: 2451545.0, barycentric: true }
];

/** The moons whose day is not their orbit; `build.ts` holds every other moon to its lock. */
export const FREELY_SPINNING_MOONS = new Set(BODY_SPECS.filter((spec) => spec.spinsFreely).map((spec) => spec.id));

/**
 * Writes `bodies.json` for the major planets, the five dwarf planets, and every moon in JPL's
 * mean-element table more than 100 km in mean radius — Phoebe, at 106.6, the smallest: JPL's
 * mean orbital elements for where they go, or the SBDB's osculating ones where there are none,
 * JPL Horizons for their size and spin, and the IAU's rotational elements for where their poles
 * point and which face is where. Horizons' osculating elements for the same date come back
 * alongside, for `build.ts` to check the mean ones against.
 */
export async function fetchSolarSystem(): Promise<{ bodies: BodyRecord[]; horizonsOrbits: Map<string, OrbitalElements>; horizonsTracks: Map<string, TrackPoint[]> }> {
  console.log(`Fetching ${BODY_SPECS.length} solar-system bodies from JPL (mean elements, Horizons, NAIF's PCK)...`);
  const bodies: BodyRecord[] = [];
  const horizonsOrbits = new Map<string, OrbitalElements>();
  const horizonsTracks = new Map<string, TrackPoint[]>();
  const planetElements = await fetchPlanetMeanElementsText();
  const satelliteElements = await fetchSatelliteMeanElementsHtml();
  const pck = await fetchPckText();
  // The app turns the Sun by elements it carries itself; they must be the kernel's.
  if (JSON.stringify(parsePckRotationalElements(pck, 10)?.elements) !== JSON.stringify(SUN_ROTATIONAL_ELEMENTS)) {
    throw new Error(`The Sun's rotational elements in the app, ${JSON.stringify(SUN_ROTATIONAL_ELEMENTS)}, are not the kernel's.`);
  }
  const gmById = new Map<string, number | undefined>();

  for (const spec of BODY_SPECS) {
    const result = await fetchHorizonsBody({
      command: spec.horizonsCommand,
      center: spec.center,
      cacheKey: `horizons-${spec.id}.txt`
    });

    horizonsOrbits.set(spec.id, result.orbit);
    gmById.set(spec.id, result.gmKm3PerS2);

    // NAIF numbers a small body 2 000 000 past its catalogue number: Ceres, "1;" to Horizons, is 2000001.
    const naifId = spec.horizonsCommand.endsWith(';') ? 2_000_000 + Number.parseInt(spec.horizonsCommand, 10) : Number(spec.horizonsCommand);
    const rotation = parsePckRotationalElements(pck, naifId);
    if (!rotation) {
      console.warn(`  no IAU rotational elements for ${spec.name}; its pole and meridian are not known.`);
    } else if (rotation.skippedDeg.length > 0) {
      console.log(`  ${spec.name}: ${rotation.skippedDeg.length} periodic terms under ${MIN_PERIODIC_TERM_DEG} degrees left out, the largest ${Math.max(...rotation.skippedDeg)}.`);
    }

    const parentName = BODY_SPECS.find((candidate) => candidate.id === spec.parentBodyId)?.name;
    const smallBody = spec.sbdb ? parseSmallBodyElements(await fetchSmallBodyAnswer(spec.sbdb, `sbdb-${spec.id}.json`)) : undefined;
    const read: MeanOrbit =
      smallBody ??
      (parentName
        ? parseSatelliteMeanElements(satelliteElements, parentName, spec.name, spec.apsidesRegress ?? false, spec.equatorPole)
        : parsePlanetMeanElements(planetElements, spec.id));
    const corrected: MeanOrbit = {
      ...read,
      orbit: {
        ...read.orbit,
        longitudeOfAscendingNodeDeg: read.orbit.longitudeOfAscendingNodeDeg + (spec.nodeOffsetDeg ?? 0),
        epochJd: spec.epochJd ?? read.orbit.epochJd
      },
      rates: spec.periodDays ? { ...read.rates, meanMotionDegPerDay: 360 / spec.periodDays } : read.rates
    };
    if (spec.orbitFromW && !rotation) {
      throw new Error(`${spec.name}'s orbit takes terms from a W the kernel does not give.`);
    }
    const fromW = spec.orbitFromW && orbitalTermsOfPrimeMeridian(rotation!.elements, corrected.orbit.epochJd, spec.orbitFromW.angleRateDegPerCentury);
    const mean: MeanOrbit = fromW
      ? {
          ...corrected,
          orbit: { ...corrected.orbit, meanAnomalyAtEpochDeg: corrected.orbit.meanAnomalyAtEpochDeg + fromW.meanAnomalyDeg },
          rates: { ...corrected.rates, meanMotionDegPerDay: corrected.rates.meanMotionDegPerDay + fromW.meanMotionDegPerDay, meanAnomalyTerms: fromW.meanAnomalyTerms }
        }
      : corrected;

    // Standish's fit states its own span, 3000 BC to AD 3000. The moons' table and the SBDB state
    // none, and hold for far less: each card says how far its orbit stays from Horizons over the
    // span it was measured, where the clock reaches AD 1 to AD 3000. An orbit that took terms from
    // its IAU W says so first: they move Mimas by up to 44.85 degrees, and are none of JPL's table.
    let orbitSource = fromW ? `${mean.orbitSource}, with the orbital terms of its IAU W (NAIF pck00011)` : mean.orbitSource;
    if (parentName || smallBody) {
      const stepDays = spec.trackStepDays ?? 2;
      const track = await fetchHorizonsTrack(spec.horizonsCommand, spec.center, stepDays, `horizons-track-${spec.id}-${stepDays}d.txt`);
      horizonsTracks.set(spec.id, track);
      const worst = Math.max(...track.map((point) => offsetFromTrackDeg(mean, point)));
      orbitSource += `, within ${(Math.ceil(worst * 10) / 10).toFixed(1)} degrees of Horizons from ${TRACK_START_YEAR} to ${TRACK_STOP_YEAR}`;
    }
    const radiusKm = smallBody?.radiusKm ?? spec.radiusKm ?? result.radiusKm;
    if (radiusKm === undefined) {
      console.warn(`  no physical radius found for ${spec.name}; defaulting to 0.`);
    }

    // A moon listed here is tidally locked unless its spec says otherwise, so its day is its
    // orbit: the sidereal period from the same mean motion that carries it round. Not every page
    // says so — the Moon's gives a rate, Titan's and Proteus's nothing. Every locked moon here is
    // turned by its IAU W, at this same rate (see `lockedToOrbit`), and `build.ts` checks that W and
    // the orbit keep its face to its planet from AD 1 to 3000; this day is what the renderer would
    // turn a moon without W by.
    const locked = spec.kind === 'moon' && !spec.spinsFreely;
    const rotationPeriodHours = result.tidallyLocked || locked
      ? (360 / mean.rates.meanMotionDegPerDay) * HOURS_PER_DAY
      : (spec.rotationPeriodHours ?? (smallBody ? smallBody.rotationPeriodHours : result.rotationPeriodHours));
    const parentGm = spec.barycentric && spec.parentBodyId ? gmById.get(spec.parentBodyId) : undefined;
    if (spec.barycentric && (result.gmKm3PerS2 === undefined || parentGm === undefined)) {
      throw new Error(`${spec.name} and its planet need a GM each to place their barycentre.`);
    }
    if (rotationPeriodHours === undefined) {
      console.warn(`  no rotation period found for ${spec.name}; it will not turn.`);
    }

    bodies.push({
      id: spec.id,
      systemStarId: SUN_STAR_ID,
      name: spec.name,
      kind: spec.kind,
      radiusKm: radiusKm ?? 0,
      ...(spec.semiAxesKm ? { semiAxesKm: spec.semiAxesKm } : {}),
      orbit: mean.orbit,
      rates: mean.rates,
      ...(mean.laplacePole ? { laplacePole: mean.laplacePole } : {}),
      orbitSource,
      ...(spec.measuredEccentricity !== undefined ? { measuredEccentricity: spec.measuredEccentricity } : {}),
      ...(spec.parentBodyId ? { parentBodyId: spec.parentBodyId } : {}),
      ...(parentGm !== undefined ? { massRatio: result.gmKm3PerS2! / parentGm } : {}),
      ...(rotationPeriodHours !== undefined ? { rotationPeriodHours } : {}),
      ...((result.obliquityDeg ?? spec.obliquityDeg) !== undefined ? { obliquityDeg: result.obliquityDeg ?? spec.obliquityDeg } : {}),
      ...(rotation ? { rotationalElements: locked ? lockedToOrbit(rotation.elements, mean, spec.name, spec.poleFollowsOrbit) : rotation.elements } : {})
    });
  }

  ensureDataDir();
  writeFileSync(dataPath('bodies.json'), JSON.stringify(bodies, null, 2));
  console.log(`  wrote ${bodies.length} bodies.`);
  return { bodies, horizonsOrbits, horizonsTracks };
}

/** Degrees between where a moon's or dwarf planet's mean elements put it and where Horizons has it. */
export function offsetFromTrackDeg(mean: Pick<MeanOrbit, 'orbit' | 'rates' | 'laplacePole'>, point: TrackPoint): number {
  const own = positionAtEpoch(meanElementsAt(mean.orbit, mean.rates, point.jd));
  const place = mean.laplacePole ? laplacePlaneToEquatorial(own, mean.laplacePole) : eclipticToEquatorial(own);
  const cosine = (place.x * point.x + place.y * point.y + place.z * point.z) / (Math.hypot(place.x, place.y, place.z) * Math.hypot(point.x, point.y, point.z));
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

if (require.main === module) {
  fetchSolarSystem().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
