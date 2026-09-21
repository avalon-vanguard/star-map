import { OrbitalElements } from '../../../src/app/shared/models/body.model';
import { fetchTextCached } from './http';

const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const KM_PER_AU = 149597870.7;

// Fixed reference epoch: keeps the ETL output (and its cache) stable across reruns,
// consistent with the "bake once at build time" ETL philosophy.
const REFERENCE_START = '2025-01-01';
const REFERENCE_STOP = '2025-01-02';

export interface HorizonsQuery {
  /** Horizons body id, e.g. `'499'` for Mars. */
  command: string;
  /** Horizons coordinate center, e.g. `'500@10'` (Sun) or `'500@399'` (Earth). */
  center: string;
  cacheKey: string;
}

export interface HorizonsResult {
  radiusKm?: number;
  orbit: OrbitalElements;
  /**
   * Sidereal rotation period in hours, negative where the body turns retrograde — Venus, whose
   * day runs backwards, and Triton. Absent where the page publishes none.
   */
  rotationPeriodHours?: number;
  /** Tilt of the rotation axis from the body's own orbital plane, in degrees. */
  obliquityDeg?: number;
  /** The page says "Synchronous" instead of a period: its day is its orbit. */
  tidallyLocked: boolean;
}

const RADIUS_PATTERNS = [
  /Vol\.?\s*mean\s*radius[^=]*=\s*([\d.]+)/i,
  /Mean\s*radius[^=]*=\s*([\d.]+)/i,
  /Radius\s*\(IAU\)[^=]*=\s*([\d.]+)/i,
  /Radius,?\s*\(km\)\s*=\s*([\d.]+)/i,
  /Radius\s*\(gravity\),?\s*km\s*=\s*([\d.]+)/i
];

/**
 * How each page states how fast the body turns, in the order they are tried.
 *
 * The rate in radians per second is preferred wherever it appears: it is unambiguous and it is
 * signed, which is how Venus and Triton are known to turn backwards. A period in hours or days
 * comes next, then the sexagesimal form the giant planets use, and finally the word every major
 * moon here carries instead of a number — tidally locked, so its day is its year, which the
 * caller supplies from the orbit it has already parsed.
 */
const ROTATION_RATE_PATTERN = /Rot(?:ational)?\.?\s*Rate\s*[(,]\s*rad\/s\s*\)?\s*=\s*(-?[\d.]+)/i;
const ROTATION_PERIOD_PATTERNS = [
  /Sid(?:ereal|\.)?\s*rot\.?\s*period[^=]*=\s*(-?[\d.]+)(?:\+-[\d.]+)?\s*(h|hr|hrs|d|day|days)\b/i,
  /Rotation(?:al)?\s*period[^=]*=\s*(-?[\d.]+)\s*(h|hr|hrs|d|day|days)\b/i
];
/** `9h 55m 29.711 s`, as Jupiter and Saturn state it. */
const SEXAGESIMAL_ROTATION_PATTERN = /Sid(?:ereal|\.)?\s*rot\.?\s*period[^=]*=\s*(\d+)\s*h\s*(\d+)\s*m\s*([\d.]+)\s*s/i;
const SYNCHRONOUS_PATTERN = /Rotation(?:al)?\s*period\s*=?\s*:?\s*Synchronous/i;
const OBLIQUITY_PATTERN = /Obliquity\s*to\s*orbit[^=]*=\s*(-?[\d.]+)/i;

const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = 3600;

/**
 * True where the page gives no number because the body keeps one face to its parent, so its day
 * is its orbit — every major moon here. The period itself is then Kepler's, which the caller
 * works out from the elements above and the parent's mass.
 */
export function isTidallyLocked(text: string): boolean {
  return SYNCHRONOUS_PATTERN.test(text);
}

/** Sidereal rotation period, in hours, from whichever form the page states it in. */
export function extractRotationPeriodHours(text: string): number | undefined {
  const rate = text.match(ROTATION_RATE_PATTERN);
  if (rate && Number(rate[1]) !== 0) {
    return (2 * Math.PI) / (Number(rate[1]) * SECONDS_PER_HOUR);
  }
  const sexagesimal = text.match(SEXAGESIMAL_ROTATION_PATTERN);
  if (sexagesimal) {
    return Number(sexagesimal[1]) + Number(sexagesimal[2]) / 60 + Number(sexagesimal[3]) / SECONDS_PER_HOUR;
  }
  for (const pattern of ROTATION_PERIOD_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const hours = Number(match[1]) * (match[2].toLowerCase().startsWith('d') ? HOURS_PER_DAY : 1);
      return Number.isFinite(hours) && hours !== 0 ? hours : undefined;
    }
  }
  return undefined;
}

export function extractObliquityDeg(text: string): number | undefined {
  const match = text.match(OBLIQUITY_PATTERN);
  return match ? Number(match[1]) : undefined;
}

/**
 * Queries JPL Horizons for a body's heliocentric (or planetocentric, for moons) osculating
 * orbital elements plus, when available, its mean physical radius and how it turns — all in a
 * single request (`OBJ_DATA=YES` + `EPHEM_TYPE=ELEMENTS`).
 */
export async function fetchHorizonsBody(query: HorizonsQuery): Promise<HorizonsResult> {
  const url =
    `${HORIZONS_URL}?format=text&COMMAND='${query.command}'&OBJ_DATA='YES'` +
    `&MAKE_EPHEM='YES'&EPHEM_TYPE='ELEMENTS'&CENTER='${query.center}'` +
    `&START_TIME='${REFERENCE_START}'&STOP_TIME='${REFERENCE_STOP}'&STEP_SIZE='1d'`;

  const text = await fetchTextCached(url, query.cacheKey);
  return {
    radiusKm: extractRadiusKm(text),
    orbit: extractOrbitalElements(text),
    rotationPeriodHours: extractRotationPeriodHours(text),
    obliquityDeg: extractObliquityDeg(text),
    tidallyLocked: isTidallyLocked(text)
  };
}

function extractRadiusKm(text: string): number | undefined {
  for (const pattern of RADIUS_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

function extractOrbitalElements(text: string): OrbitalElements {
  const startIndex = text.indexOf('$$SOE');
  const endIndex = text.indexOf('$$EOE');
  if (startIndex === -1 || endIndex === -1) {
    throw new Error('Horizons response did not contain an elements table ($$SOE/$$EOE).');
  }

  const block = text.slice(startIndex + '$$SOE'.length, endIndex).trim();
  const firstRecord = block.split(/\n(?=\d)/)[0];

  const epochJd = extractNumber(firstRecord, /^([\d.]+)\s*=/);
  const eccentricity = extractNumber(firstRecord, /EC\s*=\s*([-\d.Ee+]+)/);
  const inclinationDeg = extractNumber(firstRecord, /IN\s*=\s*([-\d.Ee+]+)/);
  const longitudeOfAscendingNodeDeg = extractNumber(firstRecord, /OM\s*=\s*([-\d.Ee+]+)/);
  const argumentOfPeriapsisDeg = extractNumber(firstRecord, /(?<!\w)W\s*=\s*([-\d.Ee+]+)/);
  const meanAnomalyAtEpochDeg = extractNumber(firstRecord, /MA\s*=\s*([-\d.Ee+]+)/);
  const semiMajorAxisKm = extractNumber(firstRecord, /(?<!\w)A\s*=\s*([-\d.Ee+]+)/);

  return {
    semiMajorAxisAu: semiMajorAxisKm / KM_PER_AU,
    eccentricity,
    inclinationDeg,
    longitudeOfAscendingNodeDeg,
    argumentOfPeriapsisDeg,
    meanAnomalyAtEpochDeg,
    epochJd
  };
}

function extractNumber(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Could not find pattern ${pattern} in Horizons elements record.`);
  }
  return Number(match[1]);
}
