/// <reference types="node" />
import { describe, expect, it } from 'vitest';

import { publicCountPages, stampCounts } from './public-counts';

const [readme, indexHtml] = publicCountPages(455_518, 340, 488);
const stamp = ([page, separator, stamps]: typeof readme, text: string) =>
  stampCounts(page, text, separator, stamps);

describe('stampCounts, over the pages that state the catalogue counts', () => {
  it('rewrites every count the README states, grouped as its prose groups them', () => {
    const before =
      'The map holds 68 388 catalogued stars. Of its 68 388 catalogued stars, 1 of the 2 catalogued deep-sky objects has a distance.';
    expect(stamp(readme, before)).toBe(
      'The map holds 455 518 catalogued stars. Of its 455 518 catalogued stars, 340 of the 488 catalogued deep-sky objects has a distance.',
    );
  });

  it('groups the link preview’s count by commas, as its meta tags do', () => {
    expect(stamp(indexHtml, '<meta content="68,388 catalogued stars from Hipparcos">')).toBe(
      '<meta content="455,518 catalogued stars from Hipparcos">',
    );
  });

  it('fails rather than leave a count nothing updates, when a page no longer states it', () => {
    expect(() => stamp(indexHtml, '<meta content="a star map">')).toThrow(
      /no longer states a count/,
    );
    expect(() => stamp(readme, 'The map holds 455 518 catalogued stars.')).toThrow(
      /deep-sky objects/,
    );
  });
});
