import { describe, expect, it } from 'vitest';

import { buildSearchIndex, rankSearchResults, scoreSearchMatch, SearchEntry } from './search-ranking';

function star(name: string): SearchEntry {
  return { kind: 'star', name, subtitle: 'G2V', starId: name.length };
}
function body(name: string): SearchEntry {
  return { kind: 'body', name, subtitle: 'moon', bodyId: name };
}
function exoplanet(name: string): SearchEntry {
  return { kind: 'exoplanet', name, subtitle: 'host', bodyId: name };
}

function rank(entries: readonly SearchEntry[], query: string, limit = 8): string[] {
  return rankSearchResults(buildSearchIndex(entries), query, limit).map((entry) => entry.name);
}

describe('scoreSearchMatch', () => {
  it('ranks an exact match above a prefix, a prefix above a word start, and that above a substring', () => {
    const exact = scoreSearchMatch('Io', 'Io');
    const prefix = scoreSearchMatch('Iot Cas', 'Io');
    const wordStart = scoreSearchMatch('Alpha Ionis', 'Io');
    const substring = scoreSearchMatch('Bellion', 'io');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  it('ignores case', () => {
    expect(scoreSearchMatch('Sirius', 'sirius')).toBe(scoreSearchMatch('Sirius', 'Sirius'));
  });

  it('ignores punctuation and spacing for an exact match', () => {
    // HYG writes "Gl 357"; a user may well type "gl357".
    expect(scoreSearchMatch('Gl 357', 'gl357')).toBe(scoreSearchMatch('Gl 357', 'Gl 357'));
  });

  it('treats a hyphenated part as its own word', () => {
    // "Kepler-9 c" should be reachable by its designation as well as its catalogue name.
    expect(scoreSearchMatch('Kepler-9 c', '9')).toBeGreaterThan(0);
  });

  it('does not match an unrelated name', () => {
    expect(scoreSearchMatch('Sirius', 'zzz')).toBe(0);
  });

  it('does not match an empty query', () => {
    expect(scoreSearchMatch('Sirius', '')).toBe(0);
    expect(scoreSearchMatch('Sirius', '   ')).toBe(0);
  });
});

describe('rankSearchResults', () => {
  it('surfaces an exact match that the old index-order scan could never reach', () => {
    // The moon Io sits behind 8750 stars in the index, so a scan that stopped at the first
    // 8 substring hits returned only stars named "Iot ..." and never reached it.
    const entries = [...Array.from({ length: 30 }, (_, i) => star(`Iot Star ${i}`)), body('Io')];

    expect(rank(entries, 'Io')[0]).toBe('Io');
  });

  it('keeps the rest of the matches after the exact one', () => {
    const entries = [star('Iot Cas'), body('Io'), star('Iot Boo')];
    expect(rank(entries, 'Io')).toEqual(['Io', 'Iot Boo', 'Iot Cas']);
  });

  it('prefers a prefix match over a mid-name one', () => {
    expect(rank([star('Bellion'), star('Ionis')], 'io')).toEqual(['Ionis', 'Bellion']);
  });

  it('orders equally-scored matches by kind, bodies first then stars then exoplanets', () => {
    const entries = [exoplanet('Cen x'), star('Cen y'), body('Cen z')];
    expect(rank(entries, 'Cen')).toEqual(['Cen z', 'Cen y', 'Cen x']);
  });

  it('puts the host star ahead of its own planets', () => {
    const entries = [exoplanet('Proxima Cen b'), exoplanet('Proxima Cen d'), star('Proxima Centauri')];
    expect(rank(entries, 'Proxima')[0]).toBe('Proxima Centauri');
  });

  it('breaks remaining ties by name length, then alphabetically', () => {
    const entries = [exoplanet('Kepler-1292 b'), exoplanet('Kepler-9 c'), exoplanet('Kepler-9 b'), exoplanet('Kepler-15 b')];
    expect(rank(entries, 'Kepler')).toEqual(['Kepler-9 b', 'Kepler-9 c', 'Kepler-15 b', 'Kepler-1292 b']);
  });

  it('is independent of the order entries were indexed in', () => {
    const entries = [star('Iot Cas'), body('Io'), exoplanet('Iota b')];
    expect(rank(entries, 'Io')).toEqual(rank([...entries].reverse(), 'Io'));
  });

  it('respects the limit', () => {
    const entries = Array.from({ length: 50 }, (_, i) => star(`Test ${i}`));
    expect(rank(entries, 'Test', 8)).toHaveLength(8);
  });

  it('returns nothing for a limit of zero or less', () => {
    expect(rank([star('Sirius')], 'Sirius', 0)).toEqual([]);
    expect(rank([star('Sirius')], 'Sirius', -1)).toEqual([]);
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(rank([star('Sirius'), body('Io')], '')).toEqual([]);
    expect(rank([star('Sirius'), body('Io')], '   ')).toEqual([]);
  });

  it('returns nothing when there is no match', () => {
    expect(rank([star('Sirius')], 'zzz')).toEqual([]);
  });

  it('handles an empty index', () => {
    expect(rank([], 'anything')).toEqual([]);
  });

  it('keeps both stars that genuinely share a name', () => {
    // 17 HYG names are shared by two records — binary components are separate, visitable stars.
    const entries = [star('Iot Pic'), star('Iot Pic')];
    expect(rank(entries, 'Iot Pic')).toHaveLength(2);
  });

  it('carries the full entry through, not just the name', () => {
    const [result] = rankSearchResults(buildSearchIndex([body('Io')]), 'Io', 1);
    expect(result).toMatchObject({ kind: 'body', name: 'Io', bodyId: 'Io' });
  });
});

describe('buildSearchIndex', () => {
  it('preserves every entry', () => {
    const entries = [star('A'), body('B'), exoplanet('C')];
    expect(buildSearchIndex(entries).map((indexed) => indexed.entry)).toEqual(entries);
  });

  it('precomputes the forms matching needs', () => {
    const [indexed] = buildSearchIndex([star('Alpha Cen-B')]);

    expect(indexed.normalizedName).toBe('alpha cen-b');
    expect(indexed.compactName).toBe('alphacenb');
    expect(indexed.words).toEqual(['alpha', 'cen', 'b']);
  });

  it('handles an empty list', () => {
    expect(buildSearchIndex([])).toEqual([]);
  });
});
