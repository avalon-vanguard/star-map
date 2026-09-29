import { OrbitalElements } from '../../../src/app/shared/models/body.model';
import { extractGmKm3PerS2, extractObliquityDeg, extractRadiusKm, extractRotationPeriodHours, isTidallyLocked } from '../../../src/app/shared/astro/horizons-page';
import { fetchTextCached } from './http';

const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const KM_PER_AU = 149597870.7;

// Fixed reference epoch: keeps the ETL output (and its cache) stable across reruns,
// consistent with the "bake once at build time" ETL philosophy.
const REFERENCE_START = '2025-01-01';
const REFERENCE_STOP = '2025-01-02';

export interface HorizonsQuery {
  /** Horizons body id, e.g. `'499'` for Mars, or a small body's number and a semicolon, `'1;'` for Ceres. */
  command: string;
  /** Horizons coordinate center, e.g. `'500@10'` (Sun) or `'500@399'` (Earth). */
  center: string;
  cacheKey: string;
}

export interface HorizonsResult {
  radiusKm?: number;
  orbit: OrbitalElements;
  /**
   * Sidereal rotation period in hours, negative where the page gives a negative rate —
   * Venus and Uranus. Absent where the page publishes none. The same pages also give an obliquity
   * past 90 degrees for those two, which says the same thing again; see the renderer's spinFor.
   */
  rotationPeriodHours?: number;
  /** Tilt of the rotation axis from the body's own orbital plane, in degrees. */
  obliquityDeg?: number;
  /** The page says "Synchronous" instead of a period: its day is its orbit. */
  tidallyLocked: boolean;
  /** The body's own GM, km³/s², where the page states one: what sets where a pair's barycentre lies. */
  gmKm3PerS2?: number;
}

/**
 * Queries JPL Horizons for a body's heliocentric (or planetocentric, for moons) osculating
 * orbital elements plus, when available, its mean physical radius and how it turns — all in a
 * single request (`OBJ_DATA=YES` + `EPHEM_TYPE=ELEMENTS`).
 */
export async function fetchHorizonsBody(query: HorizonsQuery): Promise<HorizonsResult> {
  const url =
    `${HORIZONS_URL}?format=text&COMMAND='${encodeURIComponent(query.command)}'&OBJ_DATA='YES'` +
    `&MAKE_EPHEM='YES'&EPHEM_TYPE='ELEMENTS'&CENTER='${query.center}'` +
    `&START_TIME='${REFERENCE_START}'&STOP_TIME='${REFERENCE_STOP}'&STEP_SIZE='1d'`;

  const text = await fetchTextCached(url, query.cacheKey);
  return {
    radiusKm: extractRadiusKm(text),
    orbit: extractOrbitalElements(text),
    rotationPeriodHours: extractRotationPeriodHours(text),
    obliquityDeg: extractObliquityDeg(text),
    tidallyLocked: isTidallyLocked(text),
    gmKm3PerS2: extractGmKm3PerS2(text)
  };
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

/** The span a moon's or dwarf planet's mean elements are checked against Horizons over, and the card names. */
export const TRACK_START_YEAR = 1950;
export const TRACK_STOP_YEAR = 2100;

/** One Horizons position: TDB Julian date, and ICRF equatorial coordinates in AU from the centre. */
export interface TrackPoint {
  jd: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Where Horizons has a body, from its centre, every `stepDays` from 1950 to 2100: the ephemeris the
 * mean elements are checked against over the whole span, where one date saw a moon at its best.
 */
export async function fetchHorizonsTrack(command: string, center: string, stepDays: number, cacheKey: string): Promise<TrackPoint[]> {
  const url =
    `${HORIZONS_URL}?format=text&COMMAND='${encodeURIComponent(command)}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'` +
    `&EPHEM_TYPE='VECTORS'&CENTER='${center}'&START_TIME='${TRACK_START_YEAR}-01-01'&STOP_TIME='${TRACK_STOP_YEAR}-01-01'` +
    `&STEP_SIZE='${stepDays}%20d'&REF_PLANE='FRAME'&REF_SYSTEM='ICRF'&VEC_TABLE='1'&OUT_UNITS='AU-D'&CSV_FORMAT='YES'&VEC_CORR='NONE'`;
  const text = await fetchTextCached(url, cacheKey);
  const startIndex = text.indexOf('$$SOE');
  const endIndex = text.indexOf('$$EOE');
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Horizons gave no vectors for ${command} from ${center}: ${text.slice(0, 300)}`);
  }
  return text
    .slice(startIndex + '$$SOE'.length, endIndex)
    .trim()
    .split(/\r?\n/)
    .map((row) => {
      const [jd, , x, y, z] = row.split(',').map((field) => field.trim());
      return { jd: Number(jd), x: Number(x), y: Number(y), z: Number(z) };
    });
}
