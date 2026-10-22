import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { dataPath } from './paths';

/** A phrase a page states a count in, and the count the assets give it now. */
type Stamp = readonly [pattern: RegExp, phrase: (group: (count: number) => string) => string];

/**
 * Rewrites the counts the README and the link preview state from the assets just written, so a
 * refresh that grows the catalogue cannot leave them quoting an older one: both said 68 388 stars
 * long after the catalogue had passed 423 000. A page that no longer holds one of its phrases
 * fails the ETL, rather than keeping a figure nothing updates.
 */
export function stampPublicCounts(): void {
  const stars = (JSON.parse(readFileSync(dataPath('stars-index.json'), 'utf8')) as { count: number }).count;
  const deepSky = JSON.parse(readFileSync(dataPath('deepsky.json'), 'utf8')) as { distancePc: number | null }[];
  const placed = deepSky.filter((record) => record.distancePc !== null).length;
  const starPhrase: Stamp = [/\d[\d ,]* catalogued stars/g, (group) => `${group(stars)} catalogued stars`];

  stamp('README.md', ' ', [
    starPhrase,
    [/\d+ of the \d+ catalogued deep-sky objects/g, (group) => `${group(placed)} of the ${group(deepSky.length)} catalogued deep-sky objects`],
  ]);
  stamp(join('src', 'index.html'), ',', [starPhrase]);
}

function stamp(page: string, separator: string, stamps: readonly Stamp[]): void {
  const path = join(process.cwd(), page);
  const group = (count: number): string => count.toLocaleString('en-US').replaceAll(',', separator);
  let text = readFileSync(path, 'utf8');
  for (const [pattern, phrase] of stamps) {
    if (!pattern.test(text)) {
      throw new Error(`${page} no longer states a count as ${pattern}; reword it back or drop the stamp.`);
    }
    text = text.replace(pattern, () => phrase(group));
  }
  writeFileSync(path, text);
  console.log(`  stamped the counts into ${page}`);
}
