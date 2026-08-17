import { writeFileSync } from 'node:fs';

import { parseSexagesimal, raDecToUnitVector } from '../../src/app/shared/astro/coordinates';
import { classifyOpenNgcType, estimateDeepSkyDistancePc, isNotableDeepSkyObject } from '../../src/app/shared/astro/deep-sky';
import { DeepSkyRecord } from '../../src/app/shared/models/deepsky.model';
import { parseCsvObjects } from './lib/csv';
import { fetchTextCached } from './lib/http';
import { dataPath, ensureDataDir } from './lib/paths';

const OPENNGC_CSV_URL = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';
/** OpenNGC publishes semicolon-separated files, not comma-separated. */
const OPENNGC_DELIMITER = ';';

const ARCMIN_PER_DEGREE = 60;

/**
 * Reads a numeric catalog column. Empty strings mean "not measured" and must become `null`
 * rather than `0`: `Number('')` is `0`, which would silently turn every unphotometered object
 * into a magnitude-0 blaze brighter than Sirius.
 */
function numericField(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textField(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** OpenNGC stores Messier numbers zero-padded ("031"); render them as "M31". */
function messierDesignation(value: string | undefined): string | null {
  const raw = textField(value);
  if (!raw) {
    return null;
  }
  const number = Number(raw);
  return Number.isFinite(number) ? `M${number}` : `M${raw}`;
}

/** OpenNGC's `Common names` column is comma-separated; the first entry is the best known. */
function primaryCommonName(value: string | undefined): string | null {
  const raw = textField(value);
  return raw ? (textField(raw.split(',')[0]) ?? null) : null;
}

/**
 * Display name, most recognisable first: a common name ("Andromeda Galaxy") beats a Messier
 * number ("M31"), which beats the raw catalog designation ("NGC0224").
 */
function resolveName(commonName: string | null, messier: string | null, designation: string): string {
  return commonName ?? messier ?? designation;
}

/**
 * Downloads the OpenNGC catalog, keeps the objects notable enough to be worth drawing, and
 * writes `deepsky.json` — each entry a unit direction on the celestial sphere plus its kind,
 * apparent size, magnitude and (where derivable) distance.
 *
 * See `DeepSkyRecord` for why these are stored as directions rather than positions.
 */
export async function fetchDeepSky(): Promise<DeepSkyRecord[]> {
  console.log('Fetching OpenNGC deep-sky catalog...');
  const csv = await fetchTextCached(OPENNGC_CSV_URL, 'openngc.csv');
  const rows = parseCsvObjects(csv, OPENNGC_DELIMITER);

  const records: DeepSkyRecord[] = [];
  let skippedUnclassified = 0;
  let skippedNotNotable = 0;
  let skippedUnpositioned = 0;

  for (const row of rows) {
    const kind = classifyOpenNgcType(row['Type']);
    if (!kind) {
      skippedUnclassified++;
      continue;
    }

    const magnitude = numericField(row['V-Mag']) ?? numericField(row['B-Mag']);
    const messier = messierDesignation(row['M']);
    const commonName = primaryCommonName(row['Common names']);

    if (!isNotableDeepSkyObject({ messier, commonName, magnitude })) {
      skippedNotNotable++;
      continue;
    }

    const raHours = parseSexagesimal(row['RA']);
    const decDeg = parseSexagesimal(row['Dec']);
    if (raHours === null || decDeg === null) {
      skippedUnpositioned++;
      continue;
    }

    const designation = textField(row['Name']) ?? '';
    if (!designation) {
      skippedUnpositioned++;
      continue;
    }

    const { x, y, z } = raDecToUnitVector(raHours, decDeg);
    const distance = estimateDeepSkyDistancePc({
      kind,
      redshift: numericField(row['Redshift']),
      parallaxMas: numericField(row['Pax'])
    });

    records.push({
      id: designation,
      name: resolveName(commonName, messier, designation),
      kind,
      x,
      y,
      z,
      angularSizeDeg: (numericField(row['MajAx']) ?? 0) / ARCMIN_PER_DEGREE,
      magnitude,
      distancePc: distance?.distancePc ?? null,
      distanceMethod: distance?.method ?? null,
      constellation: textField(row['Const']) ?? 'Unknown',
      messier
    });
  }

  // Brightest first, so a consumer taking a prefix gets the most prominent objects. Objects
  // with no measured magnitude sort last rather than being treated as infinitely bright.
  records.sort((a, b) => (a.magnitude ?? Infinity) - (b.magnitude ?? Infinity) || a.id.localeCompare(b.id));

  ensureDataDir();
  writeFileSync(dataPath('deepsky.json'), JSON.stringify(records));

  const withDistance = records.filter((record) => record.distancePc !== null).length;
  console.log(`  kept ${records.length} deep-sky objects (of ${rows.length} catalog rows).`);
  console.log(`  skipped: ${skippedUnclassified} not deep-sky, ${skippedNotNotable} too faint, ${skippedUnpositioned} unusable coordinates.`);
  console.log(`  ${withDistance}/${records.length} have a derivable distance.`);

  return records;
}

if (require.main === module) {
  fetchDeepSky().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
