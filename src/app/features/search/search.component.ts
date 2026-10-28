import { Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { NavigationStore } from '../../shared/state/navigation.store';
import { focusFirstOption, onOptionListKeydown } from '../../shared/ui/option-list-keys';
import { ReticleIconComponent } from '../../shared/ui/reticle-icon.component';
import { SearchIndexService } from './search-index.service';
import { entrySubtitle, rankSearchResults, SearchEntry, SearchResultKind } from './search-ranking';

/**
 * Rows listed, in a list that scrolls. Eight, unscrolled, was the only view of "HD 1"'s 27 563
 * matches; every row shown is classified as it is listed, so the cap stays well short of them.
 */
const MAX_RESULTS = 50;
const MIN_QUERY_LENGTH = 2;

const KIND_LABELS: Record<SearchResultKind, string> = {
  star: 'Star',
  body: 'Body',
  exoplanet: 'Exoplanet',
  deepSky: 'Deep sky',
};

/**
 * Name search across stars, solar-system bodies, exoplanets and deep-sky objects. Selecting a star
 * result jumps straight into that system's view; selecting a body/exoplanet result navigates to its
 * detail route; selecting a deep-sky object turns the map toward it — all through
 * `NavigationStore`/the router so behavior matches an in-scene click, per the "consistent state
 * across views" requirement.
 */
@Component({
  selector: 'app-search',
  imports: [ReticleIconComponent],
  template: `
    <!-- Sits on the dock's tab strip: the field is pinned to the bottom of the block and the
         results grow upward above it, so typing never moves the thing being typed into. DOM
         order stays field-then-results (flex-col-reverse), which is also the focus order. -->
    <div class="flex flex-col-reverse font-body">
      <!-- The one genuinely translucent surface, so it alone carries a (small) backdrop blur.
           The ring is the keyboard-focus indicator: a border hue shift alone is invisible over
           the star field. -->
      <div
        class="hud-brackets hud-surface relative backdrop-blur-sm transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/50"
      >
        <app-reticle-icon
          class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-accent/70"
        />
        <input
          #field
          type="text"
          placeholder="Search stars, planets, exoplanets…"
          role="combobox"
          aria-label="Search stars, planets and exoplanets"
          [attr.aria-expanded]="results().length > 0"
          [attr.aria-controls]="results().length ? 'search-results' : null"
          [value]="query()"
          (input)="onInput($event)"
          (keydown.enter)="pickFirst($event)"
          (keydown.arrowdown)="focusFirstOption($event)"
          (keydown.escape)="$event.stopPropagation(); clear()"
          class="w-full bg-transparent py-2.5 pr-3 pl-10 text-sm tracking-[0.02em] text-text caret-accent placeholder:text-muted focus:outline-none"
        />
      </div>

      <!-- One panel for both outcomes, so crossing the match boundary while typing swaps only
           the rows instead of remounting the panel. Gated on the index being ready: "no matches"
           may only ever describe a search that actually ran against the loaded catalogues. -->
      @if (indexReady() && hasQuery()) {
        <div class="hud-surface mb-2">
          @if (results().length) {
            <p class="type-label border-b border-border/40 px-3 py-1.5 text-muted">
              Matches <span class="text-accent tabular-nums">{{ matchTotal() }}</span>
              @if (matchTotal() > results().length) {
                <span> · top {{ results().length }}</span>
              }
            </p>
            <ul
              id="search-results"
              data-testid="search-results"
              role="listbox"
              aria-label="Matches"
              class="max-h-64 scheme-dark divide-y divide-border/25 overflow-y-auto [scrollbar-width:thin]"
            >
              @for (result of results(); track result.bodyId ?? result.deepSkyId ?? result.starId) {
                <li role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    (keydown)="onOptionListKeydown($event, field)"
                    (click)="select(result)"
                    class="flex w-full items-baseline gap-3 border-l border-transparent px-3 py-2 text-left transition-colors hover:border-l-accent hover:bg-accent/8 focus-visible:border-l-accent focus-visible:bg-accent/12 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
                  >
                    <span class="min-w-0 flex-1 truncate text-sm text-text">{{ result.name }}</span>
                    <!-- prettier-ignore -->
                    <span class="type-label max-w-[45%] shrink-0 truncate text-muted">{{ kindLabel(result.kind) }}@if (result.subtitle) { · {{ result.subtitle }}}</span>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="type-label px-3 py-2.5 text-center text-muted">
              Nothing in the catalog matches
              <span class="normal-case text-text">“{{ query().trim() }}”</span>
            </p>
          }
        </div>
      }
      <!-- Always there, and read out when it changes: a live region that arrives with its text
           already in it, as the lines above do, is often not read at all. -->
      <p class="sr-only" aria-live="polite">{{ status() }}</p>
    </div>
  `,
})
export class SearchComponent {
  private readonly searchIndex = inject(SearchIndexService);
  private readonly navigationStore = inject(NavigationStore);
  private readonly router = inject(Router);

  readonly query = signal('');
  /** Fires once a result has been chosen and navigation kicked off — the dock uses it to hand
   *  the view back to the readout, since the thing to look at is now the scene, not the box. */
  readonly picked = output<void>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  /** Pre-normalised once per session; re-deriving it per keystroke would stutter the render loop. */
  private readonly index = computed(() => this.searchIndex.all() ?? []);
  /** False until the catalogues have loaded — and forever if they fail, which beats a false
   *  "no matches" for bodies that exist but could not be fetched. */
  readonly indexReady = computed(() => this.searchIndex.all() !== null);

  /** True once the query is long enough to have been searched — so "no matches" is only ever
   *  reported about a search that actually ran, never about a half-typed word. */
  readonly hasQuery = computed(() => this.query().trim().length >= MIN_QUERY_LENGTH);

  /** Every match, ranked. Kept separate from the display slice so the "Matches" count can
   *  report the real total rather than the page size. */
  private readonly matches = computed(() => {
    const query = this.query().trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return [];
    }
    return rankSearchResults(this.index(), query, Number.POSITIVE_INFINITY);
  });

  readonly matchTotal = computed(() => this.matches().length);
  readonly results = computed(() =>
    this.matches()
      .slice(0, MAX_RESULTS)
      .map((entry) => ({ ...entry, subtitle: entrySubtitle(entry) })),
  );
  /** What the panel above the field says, for a screen reader: the count, or that nothing matched. */
  readonly status = computed(() => {
    if (!this.indexReady() || !this.hasQuery()) {
      return '';
    }
    return this.results().length
      ? `Matches ${this.matchTotal()}`
      : `Nothing in the catalog matches “${this.query().trim()}”`;
  });

  protected readonly focusFirstOption = focusFirstOption;
  protected readonly onOptionListKeydown = onOptionListKeydown;

  constructor() {
    void this.searchIndex.finish();
  }

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  clear(): void {
    this.query.set('');
  }

  /** Enter takes the first result, the one a reader who typed the whole name means. */
  pickFirst(event: Event): void {
    const first = this.results()[0];
    if (first) {
      event.preventDefault();
      this.select(first);
    }
  }

  focus(): void {
    this.field().nativeElement.focus();
  }

  kindLabel(kind: SearchResultKind): string {
    return KIND_LABELS[kind];
  }

  select(result: SearchEntry): void {
    this.clear();
    if (result.kind === 'star' && result.starId !== undefined) {
      this.navigationStore.selectStar(result.starId);
      // Merged, so a pick made on the map keeps its ?stars= and is a same-URL no-op there; the map
      // itself writes the ?star= of the system it then flies into.
      void this.router.navigate(['/'], { queryParamsHandling: 'merge' });
    } else if (result.kind === 'deepSky' && result.deepSkyId) {
      this.navigationStore.lookAtDeepSky(result.deepSkyId);
      void this.router.navigate(['/']);
    } else if (result.bodyId) {
      void this.router.navigate(['/body', result.bodyId]);
    }
    this.picked.emit();
  }
}
