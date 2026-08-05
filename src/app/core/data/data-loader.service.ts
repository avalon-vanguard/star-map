import { Injectable } from '@angular/core';

import { BodyRecord } from '../../shared/models/body.model';
import { DeepSkyRecord } from '../../shared/models/deepsky.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { decodeStarCatalog, StarCatalogIndex } from '../../shared/models/star-catalog';
import { StarRecord } from '../../shared/models/star.model';

export interface StarField {
  stars: StarRecord[];
  /** Positions in parsecs, in the same order as `stars`, packed as [x0,y0,z0,x1,y1,z1,...]. */
  positions: Float32Array;
}

/**
 * Loads the ETL-generated static assets (`src/assets/data/*`, served at `/assets/data/*`).
 * Each dataset is fetched at most once per app session and cached in memory.
 */
@Injectable({ providedIn: 'root' })
export class DataLoaderService {
  private starFieldPromise?: Promise<StarField>;
  private bodiesPromise?: Promise<BodyRecord[]>;
  private exoplanetsPromise?: Promise<ExoplanetRecord[]>;
  private deepSkyPromise?: Promise<DeepSkyRecord[]>;

  loadStars(): Promise<StarField> {
    this.starFieldPromise ??= this.fetchStars();
    return this.starFieldPromise;
  }

  loadBodies(): Promise<BodyRecord[]> {
    this.bodiesPromise ??= this.fetchJson<BodyRecord[]>('assets/data/bodies.json');
    return this.bodiesPromise;
  }

  loadExoplanets(): Promise<ExoplanetRecord[]> {
    this.exoplanetsPromise ??= this.fetchJson<ExoplanetRecord[]>('assets/data/exoplanets.json');
    return this.exoplanetsPromise;
  }

  loadDeepSky(): Promise<DeepSkyRecord[]> {
    this.deepSkyPromise ??= this.fetchJson<DeepSkyRecord[]>('assets/data/deepsky.json');
    return this.deepSkyPromise;
  }

  /**
   * Three assets rather than one, fetched in parallel: the strings as JSON, and the numbers as
   * two binary column stores. See `star-catalog.ts` for why the catalogue is not a single array
   * of JSON objects.
   */
  private async fetchStars(): Promise<StarField> {
    const [index, positionBuffer, metaBuffer] = await Promise.all([
      fetch('assets/data/stars-index.json').then((response) => response.json() as Promise<StarCatalogIndex>),
      fetch('assets/data/stars.bin').then((response) => response.arrayBuffer()),
      fetch('assets/data/stars-meta.bin').then((response) => response.arrayBuffer())
    ]);

    const positions = new Float32Array(positionBuffer);
    return { stars: decodeStarCatalog(index, positions, metaBuffer), positions };
  }

  private fetchJson<T>(url: string): Promise<T> {
    return fetch(url).then((response) => response.json() as Promise<T>);
  }
}
