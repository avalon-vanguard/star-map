import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { BodyDetailViewModel } from '../body-detail/body-detail.model';
import { bodyReadouts } from '../body-detail/body-readouts';
import { BookmarksStore } from '../../shared/state/bookmarks.store';
import { BookmarkIconComponent } from '../../shared/ui/bookmark-icon.component';
import { ReadoutSectionsComponent } from '../body-detail/readout-sections.component';
import { ChevronIconComponent } from '../../shared/ui/chevron-icon.component';

/**
 * The card shown for a body picked in the system view, without leaving it.
 *
 * Selecting a planet used to navigate straight to `/body/:id`, which tore down the system scene
 * and the camera position with it — so comparing two planets meant flying back in twice. This
 * shows the same numbers over the live view, and keeps the route as the deliberate step for the
 * full 3D inspection.
 *
 * The rows come from `bodyReadouts` via `ReadoutSectionsComponent`, both shared with the detail
 * page. Presentational only.
 */
@Component({
  selector: 'app-system-object-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BookmarkIconComponent, ChevronIconComponent, ReadoutSectionsComponent],
  // Positioned and full-bleed like the HUD's own host, so the panel inside it resolves against
  // the scene rather than against whatever box the inline default would have left it in — which
  // put the card off the bottom-left corner of the viewport entirely.
  host: { class: 'pointer-events-none absolute inset-0 block' },
  template: `
    <!-- Positioning and panel styling stay on separate elements, so the panel's own layout
         never fights the absolute placement. Same organism as the detail page's info panel:
         header, shared readout sections, and a route rail — there at the top, here at the
         bottom, because here the route is the next step rather than the way back. -->
    <div class="pointer-events-auto absolute top-6 right-6 w-80 max-w-[calc(100%-3rem)]">
      <div data-testid="object-card" class="hud-brackets hud-acquire hud-surface font-body text-text">
        <div class="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <header class="min-w-0">
            <p class="truncate text-lg leading-tight font-bold tracking-[0.04em] text-text uppercase">{{ body().name }}</p>
            <p class="type-eyebrow mt-1 truncate text-accent">{{ readouts().kindLabel }} · {{ body().hostStarName }}</p>
          </header>
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
          <button
            type="button"
            (click)="dismissed.emit()"
            aria-label="Close"
            class="-mt-2 -mr-2 shrink-0 p-1 text-muted transition-colors hover:text-accent focus-visible:text-accent focus-visible:outline-1 focus-visible:outline-accent"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        <app-readout-sections [readouts]="readouts()" />

        <button
          type="button"
          (click)="openRequested.emit()"
          class="type-label flex w-full items-center justify-center gap-1.5 border-t border-border/40 px-3 py-2 text-muted transition-colors hover:bg-accent/8 hover:text-accent focus-visible:bg-accent/12 focus-visible:text-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
        >
          Full view
          <app-chevron-icon class="h-3 w-3" direction="right" />
        </button>
      </div>
    </div>
  `
})
export class SystemObjectCardComponent {
  readonly body = input.required<BodyDetailViewModel>();
  /** The close control, and anything else that should dismiss the card. */
  readonly dismissed = output<void>();
  /** Request for the full `/body/:id` route. */
  readonly openRequested = output<void>();

  readonly bookmarks = inject(BookmarksStore);

  readonly readouts = computed(() => bodyReadouts(this.body()));
}
