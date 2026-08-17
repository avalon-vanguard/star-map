import { Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';

import { DataLoaderService } from '../../core/data/data-loader.service';
import { NavigationStore } from '../../shared/state/navigation.store';
import { buildSearchIndex, IndexedSearchEntry, rankSearchResults, SearchEntry, SearchResultKind } from './search-ranking';

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
    <div class="fixed top-4 left-1/2 z-20 w-[26rem] max-w-[calc(100%-2rem)] -translate-x-1/2 font-body">
      <div class="hud-brackets relative border border-border/60 bg-panel/85 backdrop-blur-md transition-colors focus-within:border-accent/70">
        <svg class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-accent/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        <input
          type="text"
          placeholder="Search stars, planets, exoplanets…"
          [value]="query()"
          (input)="onInput($event)"
          (keydown.escape)="clear()"
          class="w-full bg-transparent py-2.5 pr-3 pl-10 text-sm tracking-[0.02em] text-text caret-accent placeholder:text-muted focus:outline-none"
        />
      </div>

      @if (results().length) {
        <div class="hud-acquire mt-2 border border-border/60 bg-panel/92 backdrop-blur-md">
          <p class="border-b border-border/40 px-3 py-1.5 text-[10px] tracking-[0.16em] text-muted uppercase">Matches <span class="text-accent tabular-nums">{{ results().length }}</span></p>
          <ul data-testid="search-results" class="divide-y divide-border/25">
            @for (result of results(); track result.bodyId ?? result.starId) {
              <li>
                <button
                  type="button"
                  (click)="select(result)"
                  class="flex w-full items-baseline gap-3 border-l border-transparent px-3 py-2 text-left transition-colors hover:border-l-accent hover:bg-accent/8 focus-visible:border-l-accent focus-visible:bg-accent/12 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
                >
                  <span class="min-w-0 flex-1 truncate text-sm text-text">{{ result.name }}</span>
                  <span class="max-w-[45%] shrink-0 truncate text-[10px] tracking-[0.14em] text-muted uppercase">{{ kindLabel(result.kind) }} · {{ result.subtitle }}</span>
                </button>
              </li>
            }
          </ul>
        </div>
      } @else if (hasQuery()) {
        <p class="hud-acquire mt-2 border border-border/60 bg-panel/92 px-3 py-2.5 text-center text-[11px] tracking-[0.14em] text-muted uppercase backdrop-blur-md">Nothing in the catalog matches <span class="normal-case text-text">“{{ query().trim() }}”</span></p>
      }
    </div>
  `
})
export class SearchComponent {
  readonly query = signal('');
  /** Pre-normalised once on load; re-deriving it per keystroke would stutter the render loop. */
  private readonly index = signal<IndexedSearchEntry[]>([]);

  /** True once the query is long enough to have been searched — so "no matches" is only ever
   *  reported about a search that actually ran, never about a half-typed word. */
  readonly hasQuery = computed(() => this.query().trim().length >= MIN_QUERY_LENGTH);

  readonly results = computed(() => {
    const query = this.query().trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return [];
    }
    return rankSearchResults(this.index(), query, MAX_RESULTS);
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

      this.index.set(buildSearchIndex(entries));
    } catch (error) {
      console.error('Failed to build the search index.', error);
    }
  }
}
