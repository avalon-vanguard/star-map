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
