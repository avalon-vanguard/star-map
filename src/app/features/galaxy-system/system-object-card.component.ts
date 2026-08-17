import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { BodyDetailViewModel } from '../body-detail/body-detail.model';
import { bodyReadouts } from '../body-detail/body-readouts';

/**
 * The card shown for a body picked in the system view, without leaving it.
 *
 * Selecting a planet used to navigate straight to `/body/:id`, which tore down the system scene
 * and the camera position with it — so comparing two planets meant flying back in twice. This
 * shows the same numbers over the live view, and keeps the route as the deliberate step for the
 * full 3D inspection.
 *
 * The rows themselves come from `bodyReadouts`, shared with the detail page. Presentational only.
 */
@Component({
  selector: 'app-system-object-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Positioned and full-bleed like the HUD's own host, so the panel inside it resolves against
  // the scene rather than against whatever box the inline default would have left it in — which
  // put the card off the bottom-left corner of the viewport entirely.
  host: { class: 'pointer-events-none absolute inset-0 block' },
  template: `
    <!-- Positioning and panel styling stay on separate elements, so the panel's own layout
         never fights the absolute placement. Same organism as the detail page's info panel:
         header, full-bleed readout rows, provenance, and a route rail — there at the top,
         here at the bottom, because here the route is the next step rather than the way back. -->
    <div class="pointer-events-auto absolute top-16 right-6 w-80 max-w-[calc(100%-3rem)]">
      <div data-testid="object-card" class="hud-brackets hud-acquire border border-border/60 bg-panel/92 font-body text-text backdrop-blur-md">
        <div class="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <header class="min-w-0">
            <p class="truncate text-lg leading-tight font-bold tracking-[0.04em] text-text uppercase">{{ body().name }}</p>
            <p class="mt-1 truncate text-[10px] tracking-[0.18em] text-accent uppercase">{{ readouts().kindLabel }} · {{ body().hostStarName }}</p>
          </header>
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

        @if (readouts().measured.length) {
          <p class="border-t border-border/40 px-4 pt-3 pb-1 text-[10px] tracking-[0.16em] text-muted uppercase">Measured</p>
          <dl class="divide-y divide-border/25">
            @for (row of readouts().measured; track row.label) {
              <div class="flex items-baseline justify-between gap-4 px-4 py-2">
                <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">{{ row.label }}</dt>
                <dd class="text-sm tabular-nums">{{ row.value }}</dd>
              </div>
            }
          </dl>
        }

        <p class="border-t border-border/40 px-4 pt-3 pb-1 text-[10px] tracking-[0.16em] text-muted uppercase">Derived</p>
        <dl class="divide-y divide-border/25">
          @for (row of readouts().derived; track row.label) {
            <div class="flex items-baseline justify-between gap-4 px-4 py-2">
              <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">{{ row.label }}</dt>
              <dd class="text-sm tabular-nums">{{ row.value }}</dd>
            </div>
          }
        </dl>

        <p class="border-t border-border/40 px-4 py-3 text-[10px] leading-relaxed text-muted">{{ readouts().provenance }}</p>

        <button
          type="button"
          (click)="openRequested.emit()"
          class="flex w-full items-center justify-center gap-1.5 border-t border-border/40 px-3 py-2 text-[10px] tracking-[0.16em] text-muted uppercase transition-colors hover:bg-accent/8 hover:text-accent focus-visible:bg-accent/12 focus-visible:text-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
        >
          Full view
          <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
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

  readonly readouts = computed(() => bodyReadouts(this.body()));
}
