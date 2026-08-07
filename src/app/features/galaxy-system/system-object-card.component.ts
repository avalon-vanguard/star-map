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
    <!-- Positioning and panel styling stay on separate elements. The hud-panel rule sets
         position: relative for its own inset border, which silently overrides an absolute on the
         same element and turns top/right into offsets from wherever the box already sat. -->
    <div class="pointer-events-auto absolute top-16 right-6 w-80 max-w-[calc(100%-3rem)]">
      <div data-testid="object-card" class="hud-panel px-4 py-3 font-body">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-display text-lg tracking-[0.04em] text-text">{{ body().name }}</p>
            <p class="mt-0.5 font-display text-[10px] tracking-[0.22em] text-accent uppercase">{{ readouts().kindLabel }} · {{ body().hostStarName }}</p>
          </div>
          <button
            type="button"
            (click)="dismissed.emit()"
            aria-label="Close"
            class="-mt-1 -mr-1 shrink-0 rounded-sm p-1 text-muted transition-colors hover:text-accent focus:text-accent focus:outline-none"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        @if (readouts().measured.length) {
          <p class="mt-3 text-[10px] tracking-[0.18em] text-muted uppercase">Measured</p>
          <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            @for (row of readouts().measured; track row.label) {
              <dt class="text-muted">{{ row.label }}</dt>
              <dd class="text-right text-text tabular-nums">{{ row.value }}</dd>
            }
          </dl>
        }

        <p class="mt-3 text-[10px] tracking-[0.18em] text-muted uppercase">Derived</p>
        <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          @for (row of readouts().derived; track row.label) {
            <dt class="text-muted">{{ row.label }}</dt>
            <dd class="text-right text-text tabular-nums">{{ row.value }}</dd>
          }
        </dl>

        <p class="mt-3 border-t border-border/50 pt-2 text-[10px] leading-relaxed text-muted">{{ readouts().provenance }}</p>

        <button
          type="button"
          (click)="openRequested.emit()"
          class="mt-3 flex w-full items-center justify-center gap-1.5 border border-border/70 bg-panel/60 px-3 py-1.5 font-display text-[10px] tracking-[0.22em] text-muted uppercase transition-colors hover:border-accent hover:text-accent focus:border-accent focus:text-accent focus:outline-none"
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
