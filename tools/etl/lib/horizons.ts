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
}

const RADIUS_PATTERNS = [
  /Vol\.?\s*mean\s*radius[^=]*=\s*([\d.]+)/i,
  /Mean\s*radius[^=]*=\s*([\d.]+)/i,
  /Radius\s*\(IAU\)[^=]*=\s*([\d.]+)/i,
  /Radius,?\s*\(km\)\s*=\s*([\d.]+)/i,
  /Radius\s*\(gravity\),?\s*km\s*=\s*([\d.]+)/i
];

/**
 * Queries JPL Horizons for a body's heliocentric (or planetocentric, for moons) osculating
 * orbital elements plus, when available, its mean physical radius — both in a single
 * request (`OBJ_DATA=YES` + `EPHEM_TYPE=ELEMENTS`).
 */
export async function fetchHorizonsBody(query: HorizonsQuery): Promise<HorizonsResult> {
  const url =
    `${HORIZONS_URL}?format=text&COMMAND='${query.command}'&OBJ_DATA='YES'` +
    `&MAKE_EPHEM='YES'&EPHEM_TYPE='ELEMENTS'&CENTER='${query.center}'` +
    `&START_TIME='${REFERENCE_START}'&STOP_TIME='${REFERENCE_STOP}'&STEP_SIZE='1d'`;

  const text = await fetchTextCached(url, query.cacheKey);
  return {
    radiusKm: extractRadiusKm(text),
    orbit: extractOrbitalElements(text)
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
