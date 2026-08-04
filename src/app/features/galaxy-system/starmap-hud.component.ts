import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ViewLevel } from '../../shared/state/navigation.store';

export interface HudReadout {
  readonly label: string;
  readonly value: string;
}

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
 * The map's heads-up display: the scale ladder down the left, the readout panel across the
 * bottom, a centre reticle on whatever the camera is holding, and the frame brackets around
 * the whole viewport.
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
  host: { class: 'pointer-events-none absolute inset-0 block select-none' },
  template: `
    <div class="hud-frame absolute inset-0"></div>
    <div class="hud-vignette absolute inset-0"></div>

    @if (showReticle()) {
      <div class="absolute top-1/2 left-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2">
        <span class="absolute top-0 left-0 h-3 w-3 border-t border-l border-accent/70"></span>
        <span class="absolute top-0 right-0 h-3 w-3 border-t border-r border-accent/70"></span>
        <span class="absolute bottom-0 left-0 h-3 w-3 border-b border-l border-accent/70"></span>
        <span class="absolute right-0 bottom-0 h-3 w-3 border-r border-b border-accent/70"></span>
        <span class="absolute top-1/2 left-1/2 h-px w-2 -translate-x-1/2 -translate-y-1/2 bg-accent/60"></span>
        <span class="absolute top-1/2 left-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-accent/60"></span>
      </div>
    }

    <nav aria-label="Map scale" class="pointer-events-auto absolute top-1/2 left-6 flex -translate-y-1/2 flex-col gap-5">
      @for (step of ladder(); track step.level) {
        <div class="flex items-center gap-3">
          <span
            class="block h-2 w-2 rotate-45 border"
            [class]="step.state === 'current' ? 'border-accent bg-accent shadow-[0_0_10px_var(--color-accent)]' : step.state === 'above' ? 'border-accent/60' : 'border-border/60'"
          ></span>
          @if (step.reachable) {
            <button
              type="button"
              (click)="levelSelected.emit(step.level)"
              class="font-display text-[10px] tracking-[0.22em] text-muted uppercase transition-colors hover:text-accent focus:text-accent focus:outline-none"
            >
              {{ step.label }}
            </button>
          } @else {
            <span
              [attr.aria-current]="step.state === 'current' ? 'step' : null"
              [attr.data-testid]="step.state === 'current' ? 'hud-current-level' : null"
              class="font-display text-[10px] tracking-[0.22em] uppercase"
              [class]="step.state === 'current' ? 'text-accent' : 'text-border'"
              >{{ step.label }}</span
            >
          }
        </div>
      }
    </nav>

    <div class="absolute right-6 bottom-6 left-6 flex flex-wrap items-end justify-between gap-4">
      <div class="hud-panel max-w-lg px-4 py-3">
        <p class="font-display text-[10px] tracking-[0.28em] text-muted uppercase">{{ eyebrow() }}</p>
        <p class="mt-1 font-display text-xl tracking-[0.06em] text-text">{{ title() }}</p>
        @if (subtitle()) {
          <p class="mt-0.5 text-xs text-muted">{{ subtitle() }}</p>
        }
        @if (readouts().length) {
          <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            @for (readout of readouts(); track readout.label) {
              <div>
                <dt class="text-[10px] tracking-[0.18em] text-muted uppercase">{{ readout.label }}</dt>
                <dd class="text-sm text-text tabular-nums">{{ readout.value }}</dd>
              </div>
            }
          </dl>
        }
        @if (note()) {
          <p class="mt-3 border-t border-border/50 pt-2 text-[10px] leading-relaxed tracking-[0.08em] text-muted uppercase">{{ note() }}</p>
        }
      </div>

      <div class="hud-panel px-4 py-3 text-right">
        <p class="font-display text-[10px] tracking-[0.28em] text-muted uppercase">Range</p>
        <p class="mt-1 font-display text-lg text-accent tabular-nums">{{ range() }}</p>
      </div>
    </div>
  `
})
export class StarmapHudComponent {
  readonly level = input.required<ViewLevel>();
  /** Headline for the readout panel — the selected star, or the name of the current scale. */
  readonly title = input('');
  readonly subtitle = input('');
  readonly eyebrow = input('');
  readonly readouts = input<readonly HudReadout[]>([]);
  /** Standing caveat for the current view, e.g. that galactic structure is a model. */
  readonly note = input('');
  /** Camera range, pre-formatted by the scene, which is the only thing that knows the units. */
  readonly range = input('');
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
