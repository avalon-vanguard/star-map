import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Article, ArticleService } from '../../core/data/article.service';
import { BookmarksStore } from '../../shared/state/bookmarks.store';
import { BookmarkIconComponent } from '../../shared/ui/bookmark-icon.component';
import { ChevronIconComponent } from '../../shared/ui/chevron-icon.component';
import { bodyReadouts } from './body-readouts';
import { BodyDetailViewModel } from './body-detail.model';
import { ReadoutSectionsComponent } from './readout-sections.component';

/**
 * Displays the real NASA data for the currently selected body/exoplanet: kind, physical
 * size/mass, orbital elements, and (for exoplanets) discovery year. Presentational only —
 * `BodyDetailSceneComponent` supplies the view model and owns navigation state.
 *
 * The rows come from `bodyReadouts` via `ReadoutSectionsComponent`, both shared with the system
 * view's object card so the same body cannot read differently in the two places it can be
 * inspected.
 */
@Component({
  selector: 'app-info-panel',
  imports: [BookmarkIconComponent, ChevronIconComponent, ReadoutSectionsComponent],
  template: `
    <!-- Top-right, clear of the dock along the bottom; nothing else shares the top edge here. -->
    <div class="hud-brackets hud-acquire hud-surface absolute top-4 right-4 w-80 max-w-[calc(100%-2rem)] font-body text-text">
      <button
        type="button"
        (click)="goBack()"
        class="type-label flex w-full items-center gap-2 border-b border-border/40 px-4 py-2 text-muted transition-colors hover:bg-accent/8 hover:text-accent focus-visible:bg-accent/12 focus-visible:text-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
      >
        <app-chevron-icon class="h-3 w-3" direction="left" />
        System
      </button>

      <header class="flex items-start gap-2 px-4 pt-4 pb-3">
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-lg leading-tight font-bold tracking-[0.04em] text-text uppercase">{{ body().name }}</h1>
          <p class="type-eyebrow mt-1 truncate text-accent">{{ readouts().kindLabel }} · {{ body().hostStarName }}</p>
        </div>
        <button
          type="button"
          [attr.aria-label]="(bookmarks.has('body', body().id) ? 'Forget ' : 'Keep ') + body().name"
          [attr.aria-pressed]="bookmarks.has('body', body().id)"
          (click)="bookmarks.toggle({ kind: 'body', id: body().id, name: body().name })"
          class="shrink-0 p-1 transition-colors focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
          [class]="bookmarks.has('body', body().id) ? 'text-accent' : 'text-muted hover:text-accent'"
        >
          <app-bookmark-icon class="h-3.5 w-3.5" [kept]="bookmarks.has('body', body().id)" />
        </button>
      </header>

      <app-readout-sections [readouts]="readouts()" />

      <!-- Prose from elsewhere, and only when asked for. Everything above this line is a
           measurement or something derived from one; this is a person's paragraph on another
           site, so it says whose and links back to it. -->
      @if (article(); as found) {
        <!-- Capped and scrollable: a Wikipedia lead can run to a dozen lines, and this panel is
             anchored to the top of a viewport that may be a good deal shorter than the prose. -->
        <div class="max-h-56 overflow-y-auto border-t border-border/40 px-4 py-3">
          <p class="text-[11px] leading-relaxed text-muted">{{ found.extract }}</p>
          <a
            [href]="found.url"
            target="_blank"
            rel="noopener"
            class="type-label mt-2 inline-block text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent focus-visible:outline-1 focus-visible:outline-accent"
            >Wikipedia · {{ found.language }}</a
          >
        </div>
      } @else if (aboutState() !== 'idle') {
        <p class="border-t border-border/40 px-4 py-3 text-[11px] leading-relaxed text-muted">
          @switch (aboutState()) {
            @case ('loading') {
              Asking Wikipedia…
            }
            @case ('none') {
              Wikipedia has no article on {{ body().name }}.
            }
            @case ('unavailable') {
              Wikipedia could not be reached.
              <button type="button" (click)="loadArticle()" class="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent focus-visible:outline-1 focus-visible:outline-accent">Try again</button>
            }
          }
        </p>
      } @else {
        <button
          type="button"
          (click)="loadArticle()"
          class="type-label w-full border-t border-border/40 px-4 py-2 text-left text-muted transition-colors hover:bg-accent/8 hover:text-accent focus-visible:bg-accent/12 focus-visible:text-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
        >
          About
        </button>
      }
    </div>
  `
})
export class InfoPanelComponent {
  readonly body = input.required<BodyDetailViewModel>();

  readonly bookmarks = inject(BookmarksStore);

  private readonly articles = inject(ArticleService);

  readonly article = signal<Article | null>(null);
  readonly aboutState = signal<'idle' | 'loading' | 'none' | 'unavailable'>('idle');

  constructor(private readonly router: Router) {
    // The panel is reused as the route's parameter changes, so what was asked about one body
    // must not still be showing under the next one's name.
    effect(() => {
      this.body();
      this.article.set(null);
      this.aboutState.set('idle');
    });
  }

  /**
   * Fetches the article, on the press and not before. The kind goes with the name because
   * Wikipedia disambiguates by it — "Titan" alone is a list of everything called Titan.
   */
  async loadArticle(): Promise<void> {
    this.aboutState.set('loading');
    const result = await this.articles.lookup(this.body().name, this.readouts().kindLabel.toLowerCase());
    if (result.status === 'found') {
      this.article.set(result.article);
      this.aboutState.set('idle');
      return;
    }
    this.article.set(null);
    this.aboutState.set(result.status);
  }

  readonly readouts = computed(() => bodyReadouts(this.body()));

  goBack(): void {
    void this.router.navigate(['/']);
  }
}
