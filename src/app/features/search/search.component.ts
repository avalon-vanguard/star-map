import { Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';

import { DataLoaderService } from '../../core/data/data-loader.service';
import { NavigationStore } from '../../shared/state/navigation.store';

type SearchResultKind = 'star' | 'body' | 'exoplanet';

interface SearchEntry {
  kind: SearchResultKind;
  name: string;
  subtitle: string;
  /** HYG star id, for `kind: 'star'` results. */
  starId?: number;
  /** `bodies.json`/`exoplanets.json` id, for `kind: 'body' | 'exoplanet'` results. */
  bodyId?: string;
}

const MAX_RESULTS = 8;
const MIN_QUERY_LENGTH = 2;

const KIND_LABELS: Record<SearchResultKind, string> = {
  star: 'Star',
  body: 'Body',
  exoplanet: 'Exoplanet'
};

/**
 * Name search across stars, solar-system bodies, and exoplanets. Selecting a star result
 * jumps straight into that system's view; selecting a body/exoplanet result navigates to its
 * detail route — both go through `NavigationStore`/the router so behavior matches an
 * in-scene click, per the "consistent state across views" requirement.
 */
@Component({
  selector: 'app-search',
  template: `
    <div class="fixed top-4 left-1/2 z-20 w-[22rem] max-w-[calc(100%-2rem)] -translate-x-1/2 font-body">
      <div class="relative">
        <svg class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder="Search stars, planets, exoplanets…"
          [value]="query()"
          (input)="onInput($event)"
          (keydown.escape)="clear()"
          class="w-full rounded-md border border-border bg-panel/85 py-2 pl-9 pr-3 text-sm text-text backdrop-blur-md transition-colors placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
      </div>
      @if (results().length) {
        <ul data-testid="search-results" class="mt-1 divide-y divide-border/40 overflow-hidden rounded-md border border-border bg-panel/90 backdrop-blur-md">
          @for (result of results(); track result.bodyId ?? result.starId) {
            <li>
              <button
                type="button"
                (click)="select(result)"
                class="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-accent/10 focus:bg-accent/10 focus:outline-none"
              >
                <span class="text-sm text-text">{{ result.name }}</span>
                <span class="text-xs tracking-wide text-muted uppercase">{{ kindLabel(result.kind) }} · {{ result.subtitle }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `
})
export class SearchComponent {
  readonly query = signal('');
  private readonly index = signal<SearchEntry[]>([]);

  readonly results = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (query.length < MIN_QUERY_LENGTH) {
      return [];
    }
    const matches: SearchEntry[] = [];
    for (const entry of this.index()) {
      if (entry.name.toLowerCase().includes(query)) {
        matches.push(entry);
        if (matches.length >= MAX_RESULTS) {
          break;
        }
      }
    }
    return matches;
  });

  constructor(
    private readonly dataLoader: DataLoaderService,
    private readonly navigationStore: NavigationStore,
    private readonly router: Router
  ) {
    void this.buildIndex();
  }

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  clear(): void {
    this.query.set('');
  }

  kindLabel(kind: SearchResultKind): string {
    return KIND_LABELS[kind];
  }

  select(result: SearchEntry): void {
    this.clear();
    if (result.kind === 'star' && result.starId !== undefined) {
      this.navigationStore.selectStar(result.starId);
      void this.router.navigate(['/']);
    } else if (result.bodyId) {
      void this.router.navigate(['/body', result.bodyId]);
    }
  }

  private async buildIndex(): Promise<void> {
    try {
      const [{ stars }, bodies, exoplanets] = await Promise.all([
        this.dataLoader.loadStars(),
        this.dataLoader.loadBodies(),
        this.dataLoader.loadExoplanets()
      ]);

      const entries: SearchEntry[] = [
        ...stars.map((star): SearchEntry => ({ kind: 'star', name: star.name, subtitle: star.spectralType, starId: star.id })),
        ...bodies.map((body): SearchEntry => ({ kind: 'body', name: body.name, subtitle: body.kind, bodyId: body.id })),
        ...exoplanets.map((exoplanet): SearchEntry => ({ kind: 'exoplanet', name: exoplanet.name, subtitle: exoplanet.hostStarName, bodyId: exoplanet.id }))
      ];

      this.index.set(entries);
    } catch (error) {
      console.error('Failed to build the search index.', error);
    }
  }
}
