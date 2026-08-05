import { readFileSync, writeFileSync } from 'node:fs';

import { RematchSummary, rematchHostStars } from '../../src/app/shared/astro/host-star-matching';
import { ExoplanetRecord } from '../../src/app/shared/models/exoplanet.model';
import { StarRecord } from '../../src/app/shared/models/star.model';
import { dataPath } from './lib/paths';

/**
 * Reads the written assets, re-resolves every exoplanet's host star against the given catalogue,
 * and writes the exoplanets back. The matching itself lives with the matcher, in
 * `host-star-matching.ts`; this is only the file handling around it.
 */
export function rematchWrittenAssets(stars: readonly StarRecord[]): RematchSummary {
  const exoplanets = JSON.parse(readFileSync(dataPath('exoplanets.json'), 'utf8')) as ExoplanetRecord[];
  const summary = rematchHostStars(exoplanets, stars);
  writeFileSync(dataPath('exoplanets.json'), JSON.stringify(exoplanets));
  return summary;
}
