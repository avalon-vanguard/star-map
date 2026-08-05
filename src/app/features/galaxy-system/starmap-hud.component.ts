import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ViewLevel } from '../../shared/state/navigation.store';

export interface HudReadout {
  readonly label: string;
  readonly value: string;
  /**
   * True when the figure was computed from other measurements rather than catalogued directly.
   * Marked in the panel and explained in its footnote, so a reasoned number is never mistaken for
   * an observed one.
   */
  readonly derived?: boolean;
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
      <!-- A hexagon rather than a square bracket: the shape reads as a sensor lock on a body,
           and stays distinct from the rectangular panel chrome everywhere else on screen. -->
      <svg class="absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 text-accent/70" viewBox="0 0 56 56" fill="none" aria-hidden="true">
        <polygon points="28,4 48,16 48,40 28,52 8,40 8,16" stroke="currentColor" stroke-width="1" />
        <path d="M28 22v-6M28 40v-6M22 28h-6M40 28h-6" stroke="currentColor" stroke-width="1" opacity="0.8" />
      </svg>
    }

    <!-- Top rail: which scale the view is at, and what it is holding. Both sit on one line
         across the top of the display, clear of the search field above them. -->
    <nav aria-label="Map scale" class="pointer-events-auto absolute top-16 left-6 flex items-stretch gap-px">
      @for (step of ladder(); track step.level) {
        @if (step.reachable) {
          <button
            type="button"
            (click)="levelSelected.emit(step.level)"
            class="hud-tab border-y border-border/70 bg-panel/70 px-4 py-1.5 font-display text-[10px] tracking-[0.22em] text-muted uppercase backdrop-blur-sm transition-colors hover:bg-accent/15 hover:text-accent focus:bg-accent/15 focus:text-accent focus:outline-none"
          >
            {{ step.label }}
          </button>
        } @else {
          <span
            [attr.aria-current]="step.state === 'current' ? 'step' : null"
            [attr.data-testid]="step.state === 'current' ? 'hud-current-level' : null"
            class="hud-tab border-y px-4 py-1.5 font-display text-[10px] tracking-[0.22em] uppercase backdrop-blur-sm"
            [class]="step.state === 'current' ? 'border-accent/70 bg-accent/20 text-accent' : 'border-border/40 bg-panel/40 text-border'"
            >{{ step.label }}</span
          >
        }
      }
    </nav>

    @if (title()) {
      <div class="absolute top-16 left-1/2 -translate-x-1/2">
        <div class="hud-banner flex items-center gap-2.5 border-b border-accent/60 bg-panel/75 px-6 py-1.5 backdrop-blur-sm">
          <svg class="h-3 w-3 shrink-0 text-accent" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <polygon points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5" stroke="currentColor" stroke-width="1" />
            <circle cx="6" cy="6" r="1.4" fill="currentColor" />
          </svg>
          <span class="font-display text-[11px] tracking-[0.3em] text-accent uppercase">{{ title() }}</span>
        </div>
      </div>
    }

    <div class="absolute right-6 bottom-6 left-6 flex flex-wrap items-end justify-between gap-4">
      <div class="hud-panel max-w-lg px-4 py-3">
        <p class="font-display text-[10px] tracking-[0.28em] text-muted uppercase">{{ eyebrow() }}</p>
        <p data-testid="hud-title" class="mt-1 font-display text-xl tracking-[0.06em] text-text">{{ title() }}</p>
        @if (subtitle()) {
          <p class="mt-0.5 text-xs text-muted">{{ subtitle() }}</p>
        }
        @if (readouts().length) {
          <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            @for (readout of readouts(); track readout.label) {
              <div>
                <dt class="text-[10px] tracking-[0.18em] text-muted uppercase">{{ readout.label }}@if (readout.derived) {<span class="text-accent/80" aria-hidden="true">*</span>}</dt>
                <dd class="text-sm text-text tabular-nums">{{ readout.value }}</dd>
              </div>
            }
          </dl>
        }
        @if (note() || hasDerived()) {
          <p class="mt-3 border-t border-border/50 pt-2 text-[10px] leading-relaxed tracking-[0.08em] text-muted uppercase">@if (hasDerived()) {<span class="text-accent/80">*</span> Derived, not catalogued. }{{ note() }}</p>
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
  /** Whether any readout needs the derived-value footnote. */
  readonly hasDerived = computed(() => this.readouts().some((readout) => readout.derived));

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
