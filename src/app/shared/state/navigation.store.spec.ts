import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it } from 'vitest';

import { NavigationStore } from './navigation.store';

describe('NavigationStore', () => {
  let store: NavigationStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(NavigationStore);
  });

  it('starts at the galaxy view with nothing selected', () => {
    expect(store.viewLevel()).toBe('galaxy');
    expect(store.selectedStarId()).toBeNull();
    expect(store.selectedBodyId()).toBeNull();
  });

  it('selectStar updates selectedStarId', () => {
    store.selectStar(42);

    expect(store.selectedStarId()).toBe(42);
  });

  it('selectBody updates selectedBodyId', () => {
    store.selectBody('mars');

    expect(store.selectedBodyId()).toBe('mars');
  });

  it('setViewLevel switches between galaxy and system', () => {
    store.setViewLevel('system');

    expect(store.viewLevel()).toBe('system');
  });
});
