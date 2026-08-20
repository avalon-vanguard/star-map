import { Injectable, signal } from '@angular/core';

/**
 * A place someone chose to keep. Either a star, which is a system to fly into, or a body, which
 * is a page to open — the two things the map lets you arrive at.
 */
export interface Bookmark {
  readonly kind: 'star' | 'body';
  /** A HYG star id, or a `bodies.json`/`exoplanets.json` id. */
  readonly id: number | string;
  /**
   * The name as it read when it was kept. Stored rather than looked up, so the list can be
   * shown before the catalogues have loaded — and so a bookmark to something a later catalogue
   * no longer holds still says what it was rather than becoming a bare id.
   */
  readonly name: string;
}

const STORAGE_KEY = 'star-map.bookmarks';

/**
 * How many are kept. Not a limit anyone will reach by hand — it is a bound on what a corrupted
 * or hand-edited store can make the app render, and on what is written back.
 */
const MAX_BOOKMARKS = 200;

/** `${kind}:${id}`, since a star id and a body id are different kinds of thing. */
function keyOf(kind: Bookmark['kind'], id: number | string): string {
  return `${kind}:${id}`;
}

function isBookmark(value: unknown): value is Bookmark {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Bookmark>;
  return (
    (candidate.kind === 'star' || candidate.kind === 'body') &&
    (typeof candidate.id === 'number' || typeof candidate.id === 'string') &&
    typeof candidate.name === 'string'
  );
}

/**
 * The places kept between visits, in this browser and nowhere else.
 *
 * Local storage rather than an account: the map asks nobody to sign in, and a list of stars
 * somebody liked is not worth a server. Every read of it is defensive — the store is a string
 * a user can edit, another tab can write, and a browser can refuse to give at all — and a
 * failure to read or write one is never allowed to take the map down with it.
 */
@Injectable({ providedIn: 'root' })
export class BookmarksStore {
  private readonly kept = signal<readonly Bookmark[]>(this.read());

  /** Most recently kept first, which is the order they are useful in. */
  readonly bookmarks = this.kept.asReadonly();

  has(kind: Bookmark['kind'], id: number | string): boolean {
    return this.kept().some((bookmark) => bookmark.kind === kind && bookmark.id === id);
  }

  /** Keeps a place, or drops it if it was already kept. Returns whether it is kept now. */
  toggle(bookmark: Bookmark): boolean {
    const kept = this.has(bookmark.kind, bookmark.id);
    this.write(kept ? this.kept().filter((other) => !(other.kind === bookmark.kind && other.id === bookmark.id)) : [bookmark, ...this.kept()].slice(0, MAX_BOOKMARKS));
    return !kept;
  }

  remove(kind: Bookmark['kind'], id: number | string): void {
    this.write(this.kept().filter((bookmark) => !(bookmark.kind === kind && bookmark.id === id)));
  }

  private write(bookmarks: readonly Bookmark[]): void {
    this.kept.set(bookmarks);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    } catch {
      // Full, disabled, or private-mode storage. The list still works for this visit; it just
      // will not outlive it, which is a smaller loss than the alternative of failing here.
    }
  }

  private read(): Bookmark[] {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return [];
    }
    if (!raw) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      // Filtered rather than rejected wholesale: one bad entry should not lose the others, and
      // deduplicated because two entries for one place would each toggle the other's control.
      const seen = new Set<string>();
      return parsed
        .filter(isBookmark)
        .filter((bookmark) => !seen.has(keyOf(bookmark.kind, bookmark.id)) && seen.add(keyOf(bookmark.kind, bookmark.id)))
        .slice(0, MAX_BOOKMARKS)
        .map(({ kind, id, name }) => ({ kind, id, name }));
    } catch {
      return [];
    }
  }
}
