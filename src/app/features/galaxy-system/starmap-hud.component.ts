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
    <div class="hud-vignette absolute inset-0"></div>

    @if (showReticle()) {
      <!-- The same circle-and-ticks reticle the search field wears, scaled up: one lock mark
           for the whole instrument, whether it is holding a query or a body. -->
      <svg class="absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 text-accent/70" viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">
        <circle cx="28" cy="28" r="15" />
        <path d="M28 6v7M28 43v7M6 28h7M43 28h7" />
      </svg>
    }

    <!-- Top rail: which scale the view is at, and what it is holding. Both sit on one line
         across the top of the display, clear of the search field above them. -->
    <nav aria-label="Map scale" class="hud-brackets pointer-events-auto absolute top-16 left-6 flex items-stretch divide-x divide-border/40 border border-border/60 bg-panel/85 backdrop-blur-md">
      @for (step of ladder(); track step.level) {
        @if (step.reachable) {
          <button
            type="button"
            (click)="levelSelected.emit(step.level)"
            class="px-4 py-1.5 text-[10px] tracking-[0.18em] text-muted uppercase transition-colors hover:bg-accent/10 hover:text-accent focus-visible:text-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
          >
            {{ step.label }}
          </button>
        } @else {
          <span
            [attr.aria-current]="step.state === 'current' ? 'step' : null"
            [attr.data-testid]="step.state === 'current' ? 'hud-current-level' : null"
            class="px-4 py-1.5 text-[10px] tracking-[0.18em] uppercase"
            [class]="step.state === 'current' ? 'bg-accent/15 text-accent' : 'text-muted/40'"
            >{{ step.label }}</span
          >
        }
      }
    </nav>

    @if (title()) {
      <!-- Hidden on phones: the readout panel names the same thing, and at this width the
           nameplate would sit on top of the scale rail. -->
      <div class="absolute top-16 left-1/2 hidden -translate-x-1/2 sm:block">
        <div class="hud-banner hud-brackets hud-acquire flex items-center gap-2.5 border border-border/60 bg-panel/85 px-6 py-1.5 backdrop-blur-md">
          <svg class="h-3 w-3 shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          <span class="text-[11px] tracking-[0.3em] text-accent uppercase">{{ title() }}</span>
        </div>
      </div>
    }

    <div class="absolute right-6 bottom-6 left-6 flex flex-wrap items-end justify-between gap-4">
      <div class="hud-brackets hud-acquire max-w-lg border border-border/60 bg-panel/92 px-4 py-3 backdrop-blur-md">
        <p class="text-[10px] tracking-[0.16em] text-muted uppercase">{{ eyebrow() }}</p>
        <p data-testid="hud-title" class="mt-1 text-lg font-bold tracking-[0.04em] text-text uppercase">{{ title() }}</p>
        @if (subtitle()) {
          <p class="mt-0.5 text-xs text-muted">{{ subtitle() }}</p>
        }
        @if (readouts().length) {
          <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            @for (readout of readouts(); track readout.label) {
              <div>
                <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">{{ readout.label }}</dt>
                <dd class="mt-0.5 text-sm text-text tabular-nums">{{ readout.value }}</dd>
              </div>
            }
          </dl>
        }
        @if (note()) {
          <p class="mt-3 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted">{{ note() }}</p>
        }
      </div>

      <div class="hud-brackets hud-acquire border border-border/60 bg-panel/92 px-4 py-3 text-right backdrop-blur-md">
        <p class="text-[10px] tracking-[0.16em] text-muted uppercase">Range</p>
        <p class="mt-1 text-lg text-accent tabular-nums">{{ range() }}</p>
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
