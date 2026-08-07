import { DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { Router } from '@angular/router';

import { BodyDetailViewModel } from './body-detail.model';

const KIND_LABELS: Record<BodyDetailViewModel['kind'], string> = {
  planet: 'Planet',
  moon: 'Moon',
  dwarf: 'Dwarf planet',
  exoplanet: 'Exoplanet'
};

/**
 * Displays the real NASA data for the currently selected body/exoplanet: kind, physical
 * size/mass, orbital elements, and (for exoplanets) discovery year. Presentational only —
 * `BodyDetailSceneComponent` supplies the view model and owns navigation state.
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
        <p class="mt-1 truncate text-[10px] tracking-[0.18em] text-accent uppercase">{{ kindLabel() }} · {{ body().hostStarName }}</p>
      </header>

      <!-- Readout rows: label left, figure right, unit tinted back so the number is what the eye
           lands on. Tabular figures keep the decimal points aligned down the column. -->
      <dl class="divide-y divide-border/25 border-t border-border/40">
        @if (body().radiusKm) {
          <div class="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">Radius</dt>
            <dd class="text-sm tabular-nums">{{ body().radiusKm | number: '1.0-1' }} <span class="text-muted">km</span></dd>
          </div>
        }
        @if (body().massEarth) {
          <div class="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">Mass</dt>
            <dd class="text-sm tabular-nums">{{ body().massEarth | number: '1.0-2' }} <span class="text-muted">Earth masses</span></dd>
          </div>
        }
        @if (body().orbit.semiMajorAxisAu) {
          <div class="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">Semi-major axis</dt>
            <dd class="text-sm tabular-nums">{{ body().orbit.semiMajorAxisAu | number: '1.0-4' }} <span class="text-muted">AU</span></dd>
          </div>
        }
        @if (body().orbit.eccentricity !== undefined) {
          <div class="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">Eccentricity</dt>
            <dd class="text-sm tabular-nums">{{ body().orbit.eccentricity | number: '1.0-4' }}</dd>
          </div>
        }
        @if (body().orbit.inclinationDeg !== undefined) {
          <div class="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">Inclination</dt>
            <dd class="text-sm tabular-nums">{{ body().orbit.inclinationDeg | number: '1.0-2' }}<span class="text-muted">°</span></dd>
          </div>
        }
        @if (body().discoveryYear) {
          <div class="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt class="text-[10px] tracking-[0.16em] text-muted uppercase">Discovered</dt>
            <dd class="text-sm tabular-nums">{{ body().discoveryYear }}</dd>
          </div>
        }
      </dl>
    </div>
  `,
  imports: [DecimalPipe]
})
export class InfoPanelComponent {
  readonly body = input.required<BodyDetailViewModel>();

  constructor(private readonly router: Router) {}

  kindLabel(): string {
    return KIND_LABELS[this.body().kind];
  }

  goBack(): void {
    void this.router.navigate(['/']);
  }
}
