import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { dataPath } from './paths';

/** A phrase a page states a count in, and the count the assets give it now. */
type Stamp = readonly [pattern: RegExp, phrase: (group: (count: number) => string) => string];

/** A page, the separator it groups digits by, and the phrases it states counts in. */
type StampedPage = readonly [page: string, separator: string, stamps: readonly Stamp[]];

/**
 * Rewrites the counts the README and the link preview state from the assets just written, so a
 * refresh that grows the catalogue cannot leave them quoting an older one: both said 68 388 stars
 * long after the catalogue had passed 423 000. A page that no longer holds one of its phrases
 * fails the ETL, rather than keeping a figure nothing updates.
 */
export function stampPublicCounts(): void {
  const stars = (
    JSON.parse(readFileSync(dataPath('stars-index.json'), 'utf8')) as { count: number }
  ).count;
  const deepSky = JSON.parse(readFileSync(dataPath('deepsky.json'), 'utf8')) as {
    distancePc: number | null;
  }[];
  const placed = deepSky.filter((record) => record.distancePc !== null).length;

  for (const [page, separator, stamps] of publicCountPages(stars, placed, deepSky.length)) {
    const path = join(process.cwd(), page);
    writeFileSync(path, stampCounts(page, readFileSync(path, 'utf8'), separator, stamps));
    console.log(`  stamped the counts into ${page}`);
  }
}

/** The pages that state the catalogue's counts, and how each states them. */
export function publicCountPages(
  stars: number,
  placedDeepSky: number,
  deepSky: number,
): readonly StampedPage[] {
  const starPhrase: Stamp = [
    /\d[\d ,]* catalogued stars/g,
    (group) => `${group(stars)} catalogued stars`,
  ];
  return [
    [
      'README.md',
      ' ',
      [
        starPhrase,
        [
          /\d+ of the \d+ catalogued deep-sky objects/g,
          (group) => `${group(placedDeepSky)} of the ${group(deepSky)} catalogued deep-sky objects`,
        ],
      ],
    ],
    [join('src', 'index.html'), ',', [starPhrase]],
  ];
}

/** `text` with each phrase's counts rewritten, grouped by `separator`; throws on a phrase it no longer holds. */
export function stampCounts(
  page: string,
  text: string,
  separator: string,
  stamps: readonly Stamp[],
): string {
  const group = (count: number): string => count.toLocaleString('en-US').replaceAll(',', separator);
  for (const [pattern, phrase] of stamps) {
    if (!pattern.test(text)) {
      throw new Error(
        `${page} no longer states a count as ${pattern}; reword it back or drop the stamp.`,
      );
    }
    text = text.replace(pattern, () => phrase(group));
  }
  return text;
}
