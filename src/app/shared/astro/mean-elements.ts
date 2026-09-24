import { MeanElementRates, OrbitalElements } from '../models/body.model';

/**
 * Reads JPL's two tables of mean orbital elements, which the ETL fetches (see
 * `tools/etl/lib/mean-elements.ts`), into the elements and rates `bodies.json` carries.
 */

const KM_PER_AU = 149597870.7;
const J2000_JD = 2451545.0;
const DAYS_PER_JULIAN_CENTURY = 36525;
const DAYS_PER_JULIAN_YEAR = 365.25;

const PLANET_ORBIT_SOURCE = 'JPL approximate mean elements (Standish), fit for 3000 BC to AD 3000';

export interface MeanOrbit {
  orbit: OrbitalElements;
  rates: MeanElementRates;
  laplacePole?: { raDeg: number; decDeg: number };
  orbitSource: string;
}

/** Table 2a's name for each planet; Earth's row is the Earth-Moon barycentre, 4 700 km off Earth. */
const PLANET_ROW_NAMES: Record<string, string> = {
  mercury: 'Mercury',
  venus: 'Venus',
  earth: 'EM Bary',
  mars: 'Mars',
  jupiter: 'Jupiter',
  saturn: 'Saturn',
  uranus: 'Uranus',
  neptune: 'Neptune',
  pluto: 'Pluto'
};

function numbers(text: string): number[] {
  return text.trim().split(/\s+/).map(Number);
}

/**
 * Reads one planet's row pair from Table 2a, and its Table 2b terms where it has them. The
 * elements are Standish's own — a, e, I, mean longitude L, longitude of perihelion ϖ, node Ω —
 * turned into the argument of periapsis ϖ - Ω and mean anomaly L - ϖ the propagator takes.
 */
export function parsePlanetMeanElements(text: string, bodyId: string): MeanOrbit {
  const name = PLANET_ROW_NAMES[bodyId];
  const lines = text.split(/\r?\n/);
  // A row is the name followed by a number: the notes above the table start a line with "Pluto" too.
  const rows = lines.flatMap((line, index) => (name && new RegExp(`^${name}\\s+-?[\\d.]`).test(line) ? [index] : []));
  if (rows.length === 0) {
    throw new Error(`No row for ${bodyId} in Standish's Table 2a.`);
  }
  const values = [...numbers(lines[rows[0]].slice(name.length)), ...numbers(lines[rows[0] + 1])];
  if (values.length !== 12 || !values.every(Number.isFinite)) {
    throw new Error(`Standish's Table 2a rows for ${name} did not parse: ${values.join(' ')}`);
  }
  const [a, e, inclination, meanLongitude, perihelion, node, aRate, eRate, inclinationRate, meanLongitudeRate, perihelionRate, nodeRate] = values;
  // Table 2b repeats the name further down, with b, c, s, f (Pluto has b alone).
  const extra = rows[1] === undefined ? undefined : numbers(lines[rows[1]].slice(name.length));
  const [b = 0, c = 0, s = 0, f = 0] = extra ?? [];

  return {
    orbit: {
      semiMajorAxisAu: a,
      eccentricity: e,
      inclinationDeg: inclination,
      longitudeOfAscendingNodeDeg: node,
      argumentOfPeriapsisDeg: perihelion - node,
      meanAnomalyAtEpochDeg: meanLongitude - perihelion,
      epochJd: J2000_JD
    },
    rates: {
      meanMotionDegPerDay: meanLongitudeRate / DAYS_PER_JULIAN_CENTURY,
      longitudeOfAscendingNodeDegPerDay: nodeRate / DAYS_PER_JULIAN_CENTURY,
      argumentOfPeriapsisDegPerDay: (perihelionRate - nodeRate) / DAYS_PER_JULIAN_CENTURY,
      semiMajorAxisAuPerDay: aRate / DAYS_PER_JULIAN_CENTURY,
      eccentricityPerDay: eRate / DAYS_PER_JULIAN_CENTURY,
      inclinationDegPerDay: inclinationRate / DAYS_PER_JULIAN_CENTURY,
      ...(extra ? { meanAnomalyTerms: { b, c, s, f } } : {})
    },
    orbitSource: PLANET_ORBIT_SOURCE
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `1997 Jan. 16.00` as a Julian date. TT and TDB differ by under two milliseconds. */
function julianDate(year: number, month: string, day: number): number {
  const monthIndex = MONTHS.indexOf(month);
  if (monthIndex < 0) {
    throw new Error(`Unknown month ${month}.`);
  }
  return Date.UTC(year, monthIndex, 1) / 86400000 + 2440587.5 + day - 1;
}

/**
 * Reads one moon's row from the satellite page: `a e w M i node n P Pw Pnode`, then the Laplace
 * pole `RA Dec Tilt` where the section is referred to one, then a reference number.
 *
 * The page gives the two precession periods as magnitudes, so their sense is supplied here. A
 * node driven by the planet's oblateness regresses on a prograde orbit and advances on a
 * retrograde one, and the orbit's inclination says which. A periapsis advances — except where a
 * resonance forces the eccentricity, which `apsidesRegress` names: Io's and Europa's are held to
 * the line of their conjunctions, which turns backwards at 2 n(Europa) - n(Io) = 0.74 degrees a
 * day, and that is exactly the 1.625- and 1.394-year periods the table gives for them. Read as
 * advancing, Io was 0.9 degrees out and Europa 2.1.
 *
 * Uranus's and Pluto's sections are referred to the planet's equator instead, and the page does
 * not print its pole, so the caller passes it as `equatorPole`: the elements are then read
 * against that pole exactly as against a Laplace plane's.
 */
export function parseSatelliteMeanElements(
  html: string,
  planetName: string,
  moonName: string,
  apsidesRegress: boolean,
  equatorPole?: { raDeg: number; decDeg: number }
): MeanOrbit {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const section = text.indexOf(`Satellites of ${planetName} jump to`);
  if (section < 0) {
    throw new Error(`No section for the satellites of ${planetName}.`);
  }
  const row = text.slice(section).match(new RegExp(` ${moonName} ((?:-?[\\d.]+ )+)`));
  if (!row || row.index === undefined) {
    throw new Error(`No row for ${moonName} among the satellites of ${planetName}.`);
  }
  const before = text.slice(section, section + row.index);
  const epoch = [...before.matchAll(/Epoch (\d{4}) (\w{3})\. ([\d.]+) T/g)].at(-1);
  if (!epoch) {
    throw new Error(`No epoch above ${moonName}'s row.`);
  }
  // The nearest heading above the row says which plane its section is referred to; the ecliptic
  // where there is none.
  const [plane] = ['Mean ecliptic', 'Laplace plane', 'Mean equatorial'].sort((x, y) => before.lastIndexOf(y) - before.lastIndexOf(x));
  const laplace = plane === 'Laplace plane';
  const equatorial = plane === 'Mean equatorial';
  if (equatorial !== (equatorPole !== undefined)) {
    throw new Error(`${moonName}'s elements are ${equatorial ? '' : 'not '}referred to ${planetName}'s equator, and its pole was ${equatorPole ? '' : 'not '}given.`);
  }
  const values = numbers(row[1]);
  const expected = laplace ? 14 : 11;
  if (values.length !== expected || !values.every(Number.isFinite)) {
    throw new Error(`${moonName}'s row has ${values.length} numbers, ${expected} expected: ${row[1]}`);
  }
  const [aKm, e, periapsis, meanAnomaly, inclination, node, meanMotion, , periapsisPeriodYears, nodePeriodYears, raDeg, decDeg] = values;
  const nodeSense = inclination > 90 ? 1 : -1;
  const periapsisSense = apsidesRegress ? -1 : 1;
  const perDay = (periodYears: number): number => (periodYears > 0 ? 360 / (periodYears * DAYS_PER_JULIAN_YEAR) : 0);

  return {
    orbit: {
      semiMajorAxisAu: aKm / KM_PER_AU,
      eccentricity: e,
      inclinationDeg: inclination,
      longitudeOfAscendingNodeDeg: node,
      argumentOfPeriapsisDeg: periapsis,
      meanAnomalyAtEpochDeg: meanAnomaly,
      epochJd: julianDate(Number(epoch[1]), epoch[2], Number(epoch[3]))
    },
    rates: {
      meanMotionDegPerDay: meanMotion,
      longitudeOfAscendingNodeDegPerDay: nodeSense * perDay(nodePeriodYears),
      argumentOfPeriapsisDegPerDay: periapsisSense * perDay(periapsisPeriodYears)
    },
    ...(laplace ? { laplacePole: { raDeg, decDeg } } : equatorPole ? { laplacePole: equatorPole } : {}),
    orbitSource: `JPL SSD satellite mean elements, epoch ${epoch[1]} ${epoch[2]} ${Math.floor(Number(epoch[3]))}`
  };
}

/** What this reads of a JPL Small-Body Database answer (`sbdb.api?sstr=…&phys-par=1&full-prec=1`). */
export interface SbdbAnswer {
  orbit: { epoch: string; elements: Array<{ name: string; value: string | null }> };
  phys_par?: Array<{ name: string; value: string | null }>;
}

export interface SmallBody extends MeanOrbit {
  radiusKm?: number;
  rotationPeriodHours?: number;
}

/**
 * A dwarf planet from the Small-Body Database: its osculating heliocentric elements against the
 * J2000 ecliptic, the frame Standish's are in, carried round at their own mean motion n with
 * nothing turning. Standish's tables stop at Pluto and JPL publishes no mean elements for the
 * others, so these are exact on their epoch and drift from it — for Ceres, whose orbit Jupiter
 * pulls on, by degrees within decades; see the ETL's check against Horizons.
 *
 * Radius and spin come from the same answer where it has them: half the published diameter, and
 * the rotation period, in hours.
 */
export function parseSmallBodyElements(answer: SbdbAnswer): SmallBody {
  const element = (name: string): number => {
    const value = Number(answer.orbit.elements.find((candidate) => candidate.name === name)?.value ?? NaN);
    if (!Number.isFinite(value)) {
      throw new Error(`The SBDB answer has no element ${name}.`);
    }
    return value;
  };
  const physical = (name: string): number | undefined => {
    const value = Number(answer.phys_par?.find((candidate) => candidate.name === name)?.value ?? NaN);
    return Number.isFinite(value) ? value : undefined;
  };
  const epochJd = Number(answer.orbit.epoch);
  const epoch = new Date((epochJd - 2440587.5) * 86400000);
  const diameterKm = physical('diameter');
  const rotationPeriodHours = physical('rot_per');

  return {
    orbit: {
      semiMajorAxisAu: element('a'),
      eccentricity: element('e'),
      inclinationDeg: element('i'),
      longitudeOfAscendingNodeDeg: element('om'),
      argumentOfPeriapsisDeg: element('w'),
      meanAnomalyAtEpochDeg: element('ma'),
      epochJd
    },
    rates: { meanMotionDegPerDay: element('n'), longitudeOfAscendingNodeDegPerDay: 0, argumentOfPeriapsisDegPerDay: 0 },
    orbitSource: `JPL SBDB osculating elements, epoch ${epoch.getUTCFullYear()} ${MONTHS[epoch.getUTCMonth()]} ${epoch.getUTCDate()}`,
    ...(diameterKm !== undefined ? { radiusKm: diameterKm / 2 } : {}),
    ...(rotationPeriodHours !== undefined ? { rotationPeriodHours } : {})
  };
}
