import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataLoaderService, StarField } from '../../core/data/data-loader.service';
import { BodyRecord } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { NavigationStore } from '../../shared/state/navigation.store';
import { SearchComponent } from './search.component';

function starRecord(id: number, name: string): StarRecord {
  return { id, name, x: 0, y: 0, z: 0, magnitude: 5, spectralType: 'G2V', colorIndex: 0.65 };
}

/** Enough "Iot ..." stars to fill the result list ahead of the moon Io, as the real index does. */
const STARS: StarRecord[] = [
  ...Array.from({ length: 12 }, (_, i) => starRecord(100 + i, `Iot Star ${i}`)),
  starRecord(1, 'Proxima Centauri')
];

const IO: BodyRecord = {
  id: 'io',
  systemStarId: 0,
  name: 'Io',
  kind: 'moon',
  parentBodyId: 'jupiter',
  radiusKm: 1821,
  orbit: {
    semiMajorAxisAu: 0.002819,
    eccentricity: 0.004,
    inclinationDeg: 0,
    longitudeOfAscendingNodeDeg: 0,
    argumentOfPeriapsisDeg: 0,
    meanAnomalyAtEpochDeg: 0,
    epochJd: 2451545.0
  }
};

const PROXIMA_B: ExoplanetRecord = {
  id: 'Proxima Cen b',
  hostStarId: 1,
  hostStarName: 'Proxima Centauri',
  name: 'Proxima Cen b',
  orbit: { semiMajorAxisAu: 0.0485, eccentricity: 0.02 }
};

class FakeDataLoaderService {
  loadStars(): Promise<StarField> {
    return Promise.resolve({ stars: STARS, positions: new Float32Array(STARS.length * 3) });
  }
  loadBodies(): Promise<BodyRecord[]> {
    return Promise.resolve([IO]);
  }
  loadExoplanets(): Promise<ExoplanetRecord[]> {
    return Promise.resolve([PROXIMA_B]);
  }
}

describe('SearchComponent', () => {
  let fixture: ComponentFixture<SearchComponent>;
  let element: HTMLElement;
  let navigationStore: NavigationStore;
  let router: { navigate: ReturnType<typeof vi.fn> };

  async function type(query: string): Promise<void> {
    fixture.componentInstance.query.set(query);
    await fixture.whenStable();
  }

  function resultNames(): string[] {
    return [...element.querySelectorAll('[data-testid="search-results"] button')].map((button) =>
      (button.querySelector('span')?.textContent ?? '').trim()
    );
  }

  beforeEach(async () => {
    router = { navigate: vi.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [SearchComponent],
      providers: [
        { provide: DataLoaderService, useClass: FakeDataLoaderService },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SearchComponent);
    navigationStore = TestBed.inject(NavigationStore);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  it('shows no results until the query is long enough', async () => {
    await type('I');
    expect(element.querySelector('[data-testid="search-results"]')).toBeNull();
  });

  it('finds an exact match that sits behind thousands of stars in the index', async () => {
    // The regression this ranking exists for: the moon Io is indexed after every star, so the
    // old first-8-substring-hits scan filled up on "Iot ..." names and never reached it.
    await type('Io');
    expect(resultNames()[0]).toBe('Io');
  });

  it('puts a host star ahead of its own planets', async () => {
    await type('Proxima');
    expect(resultNames()[0]).toBe('Proxima Centauri');
    expect(resultNames()).toContain('Proxima Cen b');
  });

  it('shows nothing for a query that matches nothing', async () => {
    await type('zzzzz');
    expect(element.querySelector('[data-testid="search-results"]')).toBeNull();
  });

  it('selects a star and returns to the galaxy route', async () => {
    await type('Proxima Centauri');
    element.querySelector<HTMLButtonElement>('[data-testid="search-results"] button')!.click();
    await fixture.whenStable();

    expect(navigationStore.selectedStarId()).toBe(1);
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('navigates straight to a body detail route', async () => {
    await type('Io');
    element.querySelector<HTMLButtonElement>('[data-testid="search-results"] button')!.click();
    await fixture.whenStable();

    expect(router.navigate).toHaveBeenCalledWith(['/body', 'io']);
  });

  it('clears the query after a selection, so the list closes', async () => {
    await type('Io');
    element.querySelector<HTMLButtonElement>('[data-testid="search-results"] button')!.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.query()).toBe('');
    expect(element.querySelector('[data-testid="search-results"]')).toBeNull();
  });

  it('clears the query on demand', async () => {
    await type('Io');
    fixture.componentInstance.clear();
    await fixture.whenStable();

    expect(element.querySelector('[data-testid="search-results"]')).toBeNull();
  });
});
