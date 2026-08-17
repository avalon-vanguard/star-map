import { Component, computed, input } from '@angular/core';
import { Router } from '@angular/router';

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
  imports: [ChevronIconComponent, ReadoutSectionsComponent],
  template: `
    <!-- Sits below the search field until xl, beside it from there. The search field is 26rem
         wide and centred, so this right-anchored 20rem panel only clears it once the viewport
         passes ~1088px — at sm they still overlap and the search would cover the back button. -->
    <div class="hud-brackets hud-acquire hud-surface absolute top-20 right-4 w-80 max-w-[calc(100%-2rem)] font-body text-text xl:top-4">
      <button
        type="button"
        (click)="goBack()"
        class="type-label flex w-full items-center gap-2 border-b border-border/40 px-4 py-2 text-muted transition-colors hover:bg-accent/8 hover:text-accent focus-visible:bg-accent/12 focus-visible:text-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
      >
        <app-chevron-icon class="h-3 w-3" direction="left" />
        System
      </button>

      <header class="px-4 pt-4 pb-3">
        <h1 class="truncate text-lg leading-tight font-bold tracking-[0.04em] text-text uppercase">{{ body().name }}</h1>
        <p class="type-eyebrow mt-1 truncate text-accent">{{ readouts().kindLabel }} · {{ body().hostStarName }}</p>
      </header>

      <app-readout-sections [readouts]="readouts()" />
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
