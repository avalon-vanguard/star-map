import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataLoaderService, StarField } from '../../core/data/data-loader.service';
import { BodyRecord } from '../../shared/models/body.model';
import { DeepSkyRecord } from '../../shared/models/deepsky.model';
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
const ANDROMEDA = { id: 'NGC0224', name: 'Andromeda Galaxy', kind: 'galaxy', messier: 'M31' } as DeepSkyRecord;

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
  loadDeepSky(): Promise<DeepSkyRecord[]> {
    return Promise.resolve([ANDROMEDA]);
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
    expect(service.all()).toHaveLength(STARS.length + 2);
    expect(service.all()!.at(-2)!.entry.name).toBe('Mars');
    expect(service.stars().every(({ entry }) => entry.kind === 'star')).toBe(true);
  });

  it('indexes a deep-sky object by its Messier number and its designation as written, "NGC 224"', async () => {
    await service.load();
    expect(service.all()!.at(-1)!.entry).toEqual({
      kind: 'deepSky',
      name: 'Andromeda Galaxy',
      subtitle: 'Galaxy · M31',
      deepSkyId: 'NGC0224',
      aliases: ['M31', 'NGC 224']
    });
  });

  it('goes on without the deep-sky objects when their file fails, as the map does', async () => {
    const loader = TestBed.inject(DataLoaderService);
    loader.loadDeepSky = () => Promise.reject(new Error('404'));
    await service.load();
    expect(service.all()).toHaveLength(STARS.length + 1);
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

  it('yields before every slice, the first included, rather than once for all of them', async () => {
    // The catalogues are already loaded when the scene asks, so without a yield ahead of it the
    // first slice ran in the boot task; with a single yield, the rest ran as one long task.
    const timer = vi.spyOn(globalThis, 'setTimeout');
    await service.load();
    const yields = timer.mock.calls.length;
    timer.mockRestore();

    // Three slices: two of STARS_PER_SLICE and one star.
    expect(yields).toBe(3);
  });

  it('builds what is left in one go once the search tab is open, where someone is waiting on it', async () => {
    // A yield lets a frame run, and a frame on CI's software rasterizer takes about 2 s: 23
    // slices of the full catalogue left the search empty for most of a minute after typing.
    const timer = vi.spyOn(globalThis, 'setTimeout');
    void service.load();
    TestBed.createComponent(SearchComponent);
    await service.load();
    const yields = timer.mock.calls.length;
    timer.mockRestore();

    // The one already pending when the tab opened.
    expect(yields).toBe(1);
    expect(service.all()).toHaveLength(STARS.length + 2);
  });
});
