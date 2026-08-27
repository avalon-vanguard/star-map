import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Bookmark, BookmarksStore } from './bookmarks.store';

const KEY = 'star-map.bookmarks';

const SIRIUS: Bookmark = { kind: 'star', id: 32349, name: 'Sirius' };
const EARTH: Bookmark = { kind: 'body', id: 'earth', name: 'Earth' };

function store(): BookmarksStore {
  // Constructed per test, because the list is read once on construction — which is the
  // behaviour being tested for anything that seeds storage first.
  TestBed.resetTestingModule();
  return TestBed.inject(BookmarksStore);
}

describe('BookmarksStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts empty, and keeps what it is given', () => {
    const bookmarks = store();
    expect(bookmarks.bookmarks()).toEqual([]);

    expect(bookmarks.toggle(SIRIUS)).toBe(true);
    expect(bookmarks.bookmarks()).toEqual([SIRIUS]);
    expect(bookmarks.has('star', 32349)).toBe(true);
  });

  it('drops what it already had, when told the same thing twice', () => {
    const bookmarks = store();
    bookmarks.toggle(SIRIUS);

    expect(bookmarks.toggle(SIRIUS)).toBe(false);
    expect(bookmarks.bookmarks()).toEqual([]);
    expect(bookmarks.has('star', 32349)).toBe(false);
  });

  it('tells a star from a body that happen to share an id', () => {
    const bookmarks = store();
    bookmarks.toggle({ kind: 'star', id: 1, name: 'A star' });
    bookmarks.toggle({ kind: 'body', id: 1, name: 'A body' });

    expect(bookmarks.bookmarks()).toHaveLength(2);
    bookmarks.remove('star', 1);
    expect(bookmarks.bookmarks()).toEqual([{ kind: 'body', id: 1, name: 'A body' }]);
  });

  it('puts the newest first, since that is the one being come back to', () => {
    const bookmarks = store();
    bookmarks.toggle(SIRIUS);
    bookmarks.toggle(EARTH);

    expect(bookmarks.bookmarks().map((bookmark) => bookmark.name)).toEqual(['Earth', 'Sirius']);
  });

  it('survives the visit it was kept in', () => {
    store().toggle(SIRIUS);

    expect(store().bookmarks()).toEqual([SIRIUS]);
  });

  it('reads past whatever else is in there, rather than losing the lot', () => {
    localStorage.setItem(KEY, JSON.stringify([SIRIUS, { kind: 'moon', id: 1, name: 'No such kind' }, { id: 'no-kind' }, null, 42, EARTH]));

    expect(store().bookmarks()).toEqual([SIRIUS, EARTH]);
  });

  it('keeps one entry per place, however many the stored list holds', () => {
    // Two entries for one place would each toggle the other's control on and off.
    localStorage.setItem(KEY, JSON.stringify([SIRIUS, { ...SIRIUS, name: 'Sirius (again)' }]));

    expect(store().bookmarks()).toEqual([SIRIUS]);
  });

  it('treats a store that is not a list, or not JSON at all, as no bookmarks', () => {
    localStorage.setItem(KEY, '{"not":"a list"}');
    expect(store().bookmarks()).toEqual([]);

    localStorage.setItem(KEY, 'nonsense{');
    expect(store().bookmarks()).toEqual([]);
  });

  it('goes on working where the browser will not store anything at all', () => {
    // Private mode, a full quota, storage disabled by policy: reading throws, writing throws.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied');
    });

    const bookmarks = store();
    expect(bookmarks.bookmarks()).toEqual([]);
    expect(() => bookmarks.toggle(SIRIUS)).not.toThrow();
    // Kept for this visit, even though nothing will outlive it.
    expect(bookmarks.bookmarks()).toEqual([SIRIUS]);
  });

  it('bounds what a hand-edited store can make it hold', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ kind: 'star' as const, id: i, name: `Star ${i}` }));
    localStorage.setItem(KEY, JSON.stringify(many));

    expect(store().bookmarks()).toHaveLength(200);
  });
});
