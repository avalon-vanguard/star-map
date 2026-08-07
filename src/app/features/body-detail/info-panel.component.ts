import { Component, computed, input } from '@angular/core';
import { Router } from '@angular/router';

import { bodyReadouts } from './body-readouts';
import { BodyDetailViewModel } from './body-detail.model';

/**
 * Displays the real NASA data for the currently selected body/exoplanet: kind, physical
 * size/mass, orbital elements, and (for exoplanets) discovery year. Presentational only —
 * `BodyDetailSceneComponent` supplies the view model and owns navigation state.
 *
 * The rows come from `bodyReadouts`, shared with the system view's object card so the same body
 * cannot read differently in the two places it can be inspected.
 */
@Component({
  selector: 'app-info-panel',
  template: `
    <div class="absolute top-4 right-4 w-80 max-w-[calc(100%-2rem)] rounded-md border border-border bg-panel/80 p-5 font-body text-text backdrop-blur-md">
      <button
        type="button"
        (click)="goBack()"
        class="mb-3 flex items-center gap-1.5 rounded-md border border-border bg-panel/60 px-3 py-1.5 text-xs tracking-wide text-muted uppercase transition-colors hover:border-accent hover:text-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        System
      </button>

      <h1 class="mb-0.5 font-display text-lg font-semibold tracking-wide text-text">{{ body().name }}</h1>
      <p class="mb-4 text-xs tracking-wide text-accent uppercase">{{ readouts().kindLabel }} · {{ body().hostStarName }}</p>

      @if (readouts().measured.length) {
        <p class="mt-4 mb-1.5 text-[10px] tracking-[0.18em] text-muted uppercase">Measured</p>
        <dl class="grid grid-cols-[auto_1fr] gap-y-1.5 gap-x-3 text-sm">
          @for (row of readouts().measured; track row.label) {
            <dt class="text-muted">{{ row.label }}</dt>
            <dd class="text-right text-text tabular-nums">{{ row.value }}</dd>
          }
        </dl>
      }

      <p class="mt-4 mb-1.5 text-[10px] tracking-[0.18em] text-muted uppercase">Derived</p>
      <dl class="grid grid-cols-[auto_1fr] gap-y-1.5 gap-x-3 text-sm">
        @for (row of readouts().derived; track row.label) {
          <dt class="text-muted">{{ row.label }}</dt>
          <dd class="text-right text-text tabular-nums">{{ row.value }}</dd>
        }
      </dl>

      <p class="mt-3 border-t border-border/50 pt-2 text-[10px] leading-relaxed text-muted">{{ readouts().provenance }}</p>
    </div>
  `
})
export class InfoPanelComponent {
  readonly body = input.required<BodyDetailViewModel>();

  readonly readouts = computed(() => bodyReadouts(this.body()));

  constructor(private readonly router: Router) {}

  goBack(): void {
    void this.router.navigate(['/']);
  }
}
