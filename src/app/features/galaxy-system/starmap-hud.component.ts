import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ViewLevel } from '../../shared/state/navigation.store';
import { ReticleIconComponent } from '../../shared/ui/reticle-icon.component';

interface LadderStep {
  readonly level: ViewLevel;
  readonly label: string;
  /** Above the active step, on it, or below it — which is what the step is styled from. */
  readonly state: 'above' | 'current' | 'below';
  /** Whether this step is somewhere the view can be sent right now. */
  readonly reachable: boolean;
}

/** Outermost first — the order the ladder is drawn in, and the order levels nest. */
const LADDER: readonly { level: ViewLevel; label: string }[] = [
  { level: 'galactic', label: 'Milky Way' },
  { level: 'galaxy', label: 'Solar Neighbourhood' },
  { level: 'system', label: 'System' }
];

/**
 * The top of the map's heads-up display: the scale ladder on the left, the nameplate across
 * the centre, and a centre reticle on whatever the camera is holding. Readouts and tools live
 * in the dock along the bottom (`HudDockComponent`).
 *
 * Purely presentational — every value arrives as an input and the only thing it emits is a
 * request to move to another scale. The scene owns the camera and decides what that means.
 *
 * Reachable levels render as buttons and the current one renders as a static marker rather than
 * a button that does nothing. The galactic and neighbourhood scales are always reachable, in
 * both directions: they are one continuous space and the Sun is always in it. The system scale
 * is not, since there is no system to go to until a star has been picked.
 */
@Component({
  selector: 'app-starmap-hud',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReticleIconComponent],
  host: { class: 'pointer-events-none absolute inset-0 block select-none' },
  template: `
    <div class="hud-vignette absolute inset-0"></div>

    @if (showReticle()) {
      <!-- The same circle-and-ticks reticle the search field wears, scaled up: one lock mark
           for the whole instrument, whether it is holding a query or a body. -->
      <app-reticle-icon class="absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 text-accent/70" [strokeWidth]="1" />
    }

    <!-- Top rail: which scale the view is at, and what it is holding. Both sit on one line
         across the top of the display; the search lives in the dock below, so nothing sits above. -->
    <nav aria-label="Map scale" class="hud-brackets hud-surface pointer-events-auto absolute top-6 left-6 flex items-stretch divide-x divide-border/40">
      @for (step of ladder(); track step.level) {
        @if (step.reachable) {
          <button
            type="button"
            (click)="levelSelected.emit(step.level)"
            class="type-eyebrow px-4 py-1.5 text-muted transition-colors hover:bg-accent/8 hover:text-accent focus-visible:bg-accent/12 focus-visible:text-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
          >
            {{ step.label }}
          </button>
        } @else {
          <span
            [attr.aria-current]="step.state === 'current' ? 'step' : null"
            [attr.data-testid]="step.state === 'current' ? 'hud-current-level' : null"
            class="type-eyebrow px-4 py-1.5"
            [class]="step.state === 'current' ? 'bg-accent/15 text-accent' : 'text-muted/40'"
            >{{ step.label }}</span
          >
        }
      }
    </nav>

    @if (title()) {
      <!-- Hidden below lg: the readout panel names the same thing, and at narrower widths a
           long star name runs into the scale rail on its left and under the object card on its
           right — all three share the top-6 line. -->
      <div class="absolute top-6 left-1/2 hidden -translate-x-1/2 lg:block">
        <div data-testid="hud-banner" class="hud-brackets hud-acquire hud-surface flex items-center gap-2.5 px-6 py-1.5">
          <app-reticle-icon class="h-3 w-3 shrink-0 text-accent" />
          <span class="text-[11px] tracking-[0.3em] text-accent uppercase">{{ title() }}</span>
        </div>
      </div>
    }
  `
})
export class StarmapHudComponent {
  readonly level = input.required<ViewLevel>();
  /** What the view is holding, for the nameplate — the selected star, or nothing. */
  readonly title = input('');
  readonly showReticle = input(true);

  readonly levelSelected = output<ViewLevel>();

  readonly ladder = computed<readonly LadderStep[]>(() => {
    const activeIndex = LADDER.findIndex((step) => step.level === this.level());
    return LADDER.map((step, index) => ({
      ...step,
      state: index < activeIndex ? 'above' : index === activeIndex ? 'current' : 'below',
      // Every scale is somewhere the camera can be sent except the current one and the system
      // level, which needs a star picked first — there is no "the system" without a selection.
      reachable: index !== activeIndex && step.level !== 'system'
    }));
  });
}
