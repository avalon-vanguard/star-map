import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DataLoaderService, StarField } from '../../core/data/data-loader.service';
import { BodyRecord } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { SearchComponent } from './search.component';
import { SearchIndexService, STARS_PER_SLICE } from './search-index.service';

/** More stars than one slice holds, so the build has to yield at least once. */
const STARS: StarRecord[] = Array.from({ length: STARS_PER_SLICE * 2 + 1 }, (_, id) => ({
  id,
  name: `HYG ${id}`,
  x: 0,
  y: 0,
  z: 0,
  magnitude: 5,
  spectralType: 'G2V',
  colorIndex: 0.65
}));

const MARS = { id: 'mars', name: 'Mars', kind: 'planet' } as BodyRecord;

class FakeDataLoaderService {
  loadStars(): Promise<StarField> {
    return Promise.resolve({ stars: STARS, positions: new Float32Array(STARS.length * 3) });
  }
  loadBodies(): Promise<BodyRecord[]> {
    return Promise.resolve([MARS]);
  }
  loadExoplanets(): Promise<ExoplanetRecord[]> {
    return Promise.resolve([]);
  }
}

describe('SearchIndexService', () => {
  let service: SearchIndexService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: DataLoaderService, useClass: FakeDataLoaderService }] });
    service = TestBed.inject(SearchIndexService);
  });

  it('indexes every star, and the bodies after them for the search tab only', async () => {
    await service.load();
    expect(service.stars()).toHaveLength(STARS.length);
    expect(service.all()).toHaveLength(STARS.length + 1);
    expect(service.all()!.at(-1)!.entry.name).toBe('Mars');
    expect(service.stars().every(({ entry }) => entry.kind === 'star')).toBe(true);
  });

  it('builds the index once, however many times the search tab is opened', async () => {
    // The tab is remounted on every switch to it, and each mount used to normalise the whole
    // catalogue again: 166-306 ms of main thread per opening on the full one.
    const first = TestBed.createComponent(SearchComponent);
    await service.load();
    const built = service.all();
    first.destroy();
    TestBed.createComponent(SearchComponent);
    await service.load();

    expect(built).not.toBeNull();
    expect(service.all()).toBe(built);
  });

  it('lets the page run between slices of the catalogue, rather than holding it for all of them', async () => {
    let indexedBeforeTimer: boolean | undefined;
    const loading = service.load();
    setTimeout(() => (indexedBeforeTimer = service.all() !== null));
    await loading;

    expect(indexedBeforeTimer).toBe(false);
    expect(service.all()).not.toBeNull();
  });
});
