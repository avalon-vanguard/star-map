export type SearchResultKind = 'star' | 'body' | 'exoplanet';

export interface SearchEntry {
  kind: SearchResultKind;
  name: string;
  subtitle: string;
  /** HYG star id, for `kind: 'star'` results. */
  starId?: number;
  /** `bodies.json`/`exoplanets.json` id, for `kind: 'body' | 'exoplanet'` results. */
  bodyId?: string;
}

/**
 * How well a name matches, best first. The gaps are what matter: any exact match outranks every
 * prefix match, and so on, so a better kind of match can never be crowded out by a worse one.
 */
const MATCH_EXACT = 4;
const MATCH_PREFIX = 3;
const MATCH_WORD_START = 2;
const MATCH_SUBSTRING = 1;
const NO_MATCH = 0;

/**
 * Order for results that match equally well. Solar-system bodies are eighteen famous objects
 * and win ties outright; a star outranks an exoplanet because searching a name like "Proxima"
 * is usually an attempt to reach the system rather than one particular planet in it.
 */
const KIND_PRIORITY: Readonly<Record<SearchResultKind, number>> = {
  body: 0,
  star: 1,
  exoplanet: 2
};

/** Catalogue names separate their parts with spaces, hyphens, underscores and slashes. */
const WORD_SEPARATORS = /[\s\-_/]+/;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Strips everything but letters and digits, so "gj581" can match "GJ 581". */
function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A search entry with its name pre-broken into the forms matching needs.
 *
 * Built once via {@link buildSearchIndex} rather than derived per keystroke. Normalising 15,000
 * names on every character typed costs about 11 ms — most of a frame — and the search runs on
 * the same thread as the render loop, so doing it live visibly stutters the scene.
 */
export interface IndexedSearchEntry {
  readonly entry: SearchEntry;
  readonly normalizedName: string;
  readonly compactName: string;
  readonly words: readonly string[];
}

export function buildSearchIndex(entries: readonly SearchEntry[]): IndexedSearchEntry[] {
  return entries.map((entry) => {
    const normalizedName = normalize(entry.name);
    return {
      entry,
      normalizedName,
      compactName: compact(entry.name),
      words: normalizedName.split(WORD_SEPARATORS)
    };
  });
}

function scoreIndexed(indexed: IndexedSearchEntry, normalizedQuery: string, compactQuery: string): number {
  // Punctuation-insensitive as well as case-insensitive, because the catalogues are
  // inconsistent about it: HYG writes "Gl 357" where a user may well type "gl357".
  if (indexed.normalizedName === normalizedQuery || indexed.compactName === compactQuery) {
    return MATCH_EXACT;
  }
  if (indexed.normalizedName.startsWith(normalizedQuery)) {
    return MATCH_PREFIX;
  }
  if (indexed.words.some((word) => word.startsWith(normalizedQuery))) {
    return MATCH_WORD_START;
  }
  if (indexed.normalizedName.includes(normalizedQuery)) {
    return MATCH_SUBSTRING;
  }
  return NO_MATCH;
}

/**
 * How well `name` matches `query`, or {@link NO_MATCH}. The readable, allocation-per-call form
 * of {@link scoreIndexed}, kept for tests and for callers scoring a single name.
 */
export function scoreSearchMatch(name: string, query: string): number {
  const normalizedQuery = normalize(query);
  if (normalizedQuery === '') {
    return NO_MATCH;
  }
  return scoreIndexed(buildSearchIndex([{ kind: 'star', name, subtitle: '' }])[0], normalizedQuery, compact(query));
}

/**
 * The `limit` best matches for `query`, best first.
 *
 * Replaces a scan that took the first `limit` substring matches in index order — stars, then
 * bodies, then exoplanets. With 8750 stars ahead of 18 bodies, that let a worse match hide a
 * better one *and* an exact match: searching "Io" returned eight stars named "Iot ..." and
 * never reached the moon Io at all, because the scan had already filled up.
 *
 * Everything is scored before anything is taken, so the best matches win regardless of where
 * they sit in the index. Ties break on kind, then on name length — a shorter name containing
 * the query is the closer match — and finally alphabetically, so the order is fully determined
 * rather than dependent on the input order.
 */
export function rankSearchResults(index: readonly IndexedSearchEntry[], query: string, limit: number): SearchEntry[] {
  const normalizedQuery = normalize(query);
  if (limit <= 0 || normalizedQuery === '') {
    return [];
  }
  const compactQuery = compact(query);

  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const indexed of index) {
    const score = scoreIndexed(indexed, normalizedQuery, compactQuery);
    if (score > NO_MATCH) {
      scored.push({ entry: indexed.entry, score });
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_PRIORITY[a.entry.kind] - KIND_PRIORITY[b.entry.kind] ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name)
  );

  return scored.slice(0, limit).map((match) => match.entry);
}
