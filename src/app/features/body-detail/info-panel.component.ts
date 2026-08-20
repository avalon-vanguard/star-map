import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

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
    </div>
  `
})
export class InfoPanelComponent {
  readonly body = input.required<BodyDetailViewModel>();

  readonly bookmarks = inject(BookmarksStore);

  readonly readouts = computed(() => bodyReadouts(this.body()));

  constructor(private readonly router: Router) {}

  goBack(): void {
    void this.router.navigate(['/']);
  }
}
