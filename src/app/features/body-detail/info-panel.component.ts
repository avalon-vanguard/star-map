import { DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { Router } from '@angular/router';

import { PLANET_CLASS_LABELS } from '../../shared/astro/planet-appearance';
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
      <p class="mb-4 text-xs tracking-wide text-accent uppercase">{{ kindLabel() }} · {{ body().hostStarName }}</p>

      <dl class="grid grid-cols-[auto_1fr] gap-y-1.5 gap-x-3 text-sm">
        @if (body().radiusKm) {
          <dt class="text-muted">Radius</dt>
          <dd class="text-right text-text">{{ body().radiusKm | number: '1.0-1' }} km</dd>
        }
        @if (body().massEarth) {
          <dt class="text-muted">Mass</dt>
          <dd class="text-right text-text">{{ body().massEarth | number: '1.0-2' }} Earth masses</dd>
        }
        @if (body().orbit.semiMajorAxisAu) {
          <dt class="text-muted">Semi-major axis</dt>
          <dd class="text-right text-text">{{ body().orbit.semiMajorAxisAu | number: '1.0-4' }} AU</dd>
        }
        @if (body().orbit.eccentricity !== undefined) {
          <dt class="text-muted">Eccentricity</dt>
          <dd class="text-right text-text">{{ body().orbit.eccentricity | number: '1.0-4' }}</dd>
        }
        @if (body().orbit.inclinationDeg !== undefined) {
          <dt class="text-muted">Inclination</dt>
          <dd class="text-right text-text">{{ body().orbit.inclinationDeg | number: '1.0-2' }}°</dd>
        }
        @if (body().discoveryYear) {
          <dt class="text-muted">Discovered</dt>
          <dd class="text-right text-text">{{ body().discoveryYear }}</dd>
        }
      </dl>

      <p class="mt-4 mb-1.5 text-[10px] tracking-[0.18em] text-muted uppercase">Derived</p>
      <dl class="grid grid-cols-[auto_1fr] gap-y-1.5 gap-x-3 text-sm">
        <dt class="text-muted">Class</dt>
        <dd class="text-right text-text">{{ classLabel() }}</dd>
        @if (body().appearance.equilibriumTemperatureK !== null) {
          <dt class="text-muted">Equilibrium temp.</dt>
          <dd class="text-right text-text">{{ body().appearance.equilibriumTemperatureK | number: '1.0-0' }} K</dd>
        }
        @if (body().appearance.bulkDensityGramsPerCm3 !== null) {
          <dt class="text-muted">Bulk density</dt>
          <dd class="text-right text-text">{{ body().appearance.bulkDensityGramsPerCm3 | number: '1.0-2' }} g/cm³</dd>
        }
      </dl>

      <p class="mt-3 border-t border-border/50 pt-2 text-[10px] leading-relaxed text-muted">{{ surfaceProvenance() }}</p>
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

  classLabel(): string {
    return PLANET_CLASS_LABELS[this.body().appearance.planetClass];
  }

  /**
   * Says plainly which of the two the viewer is looking at. The derived surface is a reasoned
   * illustration, and a panel of real measurements sitting next to it is exactly the context in
   * which it could be mistaken for another one.
   */
  surfaceProvenance(): string {
    if (this.body().hasPhotography) {
      return 'Surface: NASA/ESA/USGS photography.';
    }
    const temperature = this.body().appearance.equilibriumTemperatureK;
    return temperature === null
      ? 'Surface illustrated from this body’s measured size and mass. Its host star is not in the catalogue, so no temperature could be derived. Not an observation — no image of this world exists.'
      : 'Surface illustrated from the measurements above — size, density and the temperature derived from its star’s output and its orbit. Not an observation — no image of this world exists.';
  }

  goBack(): void {
    void this.router.navigate(['/']);
  }
}
