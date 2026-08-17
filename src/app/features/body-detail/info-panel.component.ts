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
    <!-- Sits below the search field on narrow viewports, beside it from sm up, so the two
         top-anchored overlays never stack on top of each other on a phone. -->
    <div class="hud-brackets hud-acquire absolute top-20 right-4 w-80 max-w-[calc(100%-2rem)] border border-border/60 bg-panel/92 font-body text-text backdrop-blur-md sm:top-4">
      <button
        type="button"
        (click)="goBack()"
        class="flex w-full items-center gap-2 border-b border-border/40 px-4 py-2 text-[10px] tracking-[0.16em] text-muted uppercase transition-colors hover:bg-accent/8 hover:text-accent focus-visible:bg-accent/12 focus-visible:text-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
      >
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        System
      </button>

      <header class="px-4 pt-4 pb-3">
        <h1 class="truncate text-lg leading-tight font-bold tracking-[0.04em] text-text uppercase">{{ body().name }}</h1>
        <p class="mt-1 truncate text-[10px] tracking-[0.18em] text-accent uppercase">{{ readouts().kindLabel }} · {{ body().hostStarName }}</p>
      </header>

      <!-- Readout rows: label left, figure right. Tabular figures keep the decimal points
           aligned down the column. -->
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
