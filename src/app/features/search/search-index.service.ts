import { inject, Injectable, signal } from '@angular/core';

import { DataLoaderService } from '../../core/data/data-loader.service';
import { StarRecord } from '../../shared/models/star.model';
import { buildSearchIndex, IndexedSearchEntry, SearchEntry } from './search-ranking';

/**
 * Stars indexed per task. All 455 518 at once took 122 ms of the boot task, and the search tab,
 * which built its own copy each time it was opened, held the page 166-306 ms per opening; 20 000
 * are about 5 ms on a Ryzen 7700X, so the frames go on between slices on a machine a few times slower.
 */
export const STARS_PER_SLICE = 20_000;

function starEntry(star: StarRecord): SearchEntry {
  return { kind: 'star', name: star.name, subtitle: '', star, starId: star.id };
}

/** Lets the event loop run a frame, an input event or a timer before the next slice. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

/**
 * The names everything can be searched by, normalised once per session for the search tab and
 * the two routing fields alike. Built in slices, off the boot's critical path, the first time it
 * is asked for; the tab is remounted on every switch to it, and used to rebuild it each time.
 */
@Injectable({ providedIn: 'root' })
export class SearchIndexService {
  private readonly dataLoader = inject(DataLoaderService);
  private readonly starIndex = signal<readonly IndexedSearchEntry[]>([]);
  private readonly fullIndex = signal<readonly IndexedSearchEntry[] | null>(null);
  private building?: Promise<void>;

  /** Stars alone, for the routing fields: a route is a chain of stars. Empty until built. */
  readonly stars = this.starIndex.asReadonly();
  /** Stars, then bodies and exoplanets. Null until built — and for good if the catalogues fail to load. */
  readonly all = this.fullIndex.asReadonly();

  /** Starts the build, once; every later call shares it. */
  load(): Promise<void> {
    this.building ??= this.build();
    return this.building;
  }

  private async build(): Promise<void> {
    try {
      const [{ stars }, bodies, exoplanets] = await Promise.all([
        this.dataLoader.loadStars(),
        this.dataLoader.loadBodies(),
        this.dataLoader.loadExoplanets()
      ]);

      const starIndex: IndexedSearchEntry[] = [];
      for (let start = 0; start < stars.length; start += STARS_PER_SLICE) {
        if (start > 0) {
          await nextTask();
        }
        for (const indexed of buildSearchIndex(stars.slice(start, start + STARS_PER_SLICE).map(starEntry))) {
          starIndex.push(indexed);
        }
      }
      const others = buildSearchIndex([
        ...bodies.map((body): SearchEntry => ({ kind: 'body', name: body.name, subtitle: body.kind, bodyId: body.id })),
        ...exoplanets.map((exoplanet): SearchEntry => ({ kind: 'exoplanet', name: exoplanet.name, subtitle: exoplanet.hostStarName, bodyId: exoplanet.id }))
      ]);

      this.starIndex.set(starIndex);
      this.fullIndex.set(starIndex.concat(others));
    } catch (error) {
      console.error('Failed to build the search index.', error);
    }
  }
}
