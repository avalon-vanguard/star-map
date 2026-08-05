import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { BodyDetailViewModel } from '../body-detail/body-detail.model';
import { PLANET_CLASS_LABELS } from '../../shared/astro/planet-appearance';
import { formatAu, formatDensity, formatMassEarth, formatPeriod, formatRadiusKm, formatTemperature } from '../../shared/format/quantity';

const KIND_LABELS: Record<BodyDetailViewModel['kind'], string> = {
  planet: 'Planet',
  moon: 'Moon',
  dwarf: 'Dwarf planet',
  exoplanet: 'Exoplanet',
};

interface CardRow {
  readonly label: string;
  readonly value: string;
}

/**
 * The card shown for a body picked in the system view, without leaving it.
 *
 * Selecting a planet used to navigate straight to `/body/:id`, which tore down the system scene
 * and the camera position with it — so comparing two planets meant flying back in twice. This
 * shows the same numbers over the live view, and keeps the route as the deliberate step for the
 * full 3D inspection.
 *
 * Measured and derived quantities are kept in separate blocks, each labelled, because the
 * difference matters here more than it usually would: no exoplanet has been imaged and several
 * of these figures are reasoned rather than observed. Presentational only.
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
            <p class="truncate font-display text-lg tracking-[0.04em] text-text">
              {{ body().name }}
            </p>
            <p class="mt-0.5 font-display text-[10px] tracking-[0.22em] text-accent uppercase">{{ kindLabel() }} · {{ body().hostStarName }}</p>
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

        @if (measured().length) {
          <p class="mt-3 text-[10px] tracking-[0.18em] text-muted uppercase">Measured</p>
          <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            @for (row of measured(); track row.label) {
              <dt class="text-muted">{{ row.label }}</dt>
              <dd class="text-right text-text tabular-nums">{{ row.value }}</dd>
            }
          </dl>
        }

        <p class="mt-3 text-[10px] tracking-[0.18em] text-muted uppercase">Derived</p>
        <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          @for (row of derived(); track row.label) {
            <dt class="text-muted">{{ row.label }}</dt>
            <dd class="text-right text-text tabular-nums">{{ row.value }}</dd>
          }
        </dl>

        <p class="mt-3 border-t border-border/50 pt-2 text-[10px] leading-relaxed text-muted">
          {{ provenance() }}
        </p>

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
  `,
})
export class SystemObjectCardComponent {
  readonly body = input.required<BodyDetailViewModel>();
  /** The close control, and anything else that should dismiss the card. */
  readonly dismissed = output<void>();
  /** Request for the full `/body/:id` route. */
  readonly openRequested = output<void>();

  readonly kindLabel = computed(() => KIND_LABELS[this.body().kind]);

  /** Only what a catalogue actually published for this body. */
  readonly measured = computed<readonly CardRow[]>(() => {
    const body = this.body();
    const rows: CardRow[] = [];
    if (body.radiusKm !== undefined) {
      rows.push({ label: 'Radius', value: formatRadiusKm(body.radiusKm) });
    }
    if (body.massEarth !== undefined) {
      rows.push({ label: 'Mass', value: formatMassEarth(body.massEarth) });
    }
    if (body.orbit.semiMajorAxisAu !== undefined) {
      rows.push({ label: 'Semi-major axis', value: formatAu(body.orbit.semiMajorAxisAu) });
    }
    if (body.orbit.eccentricity !== undefined) {
      rows.push({ label: 'Eccentricity', value: body.orbit.eccentricity.toFixed(3) });
    }
    if (body.orbitalPeriodDays !== undefined && body.orbitalPeriodSource === 'measured') {
      rows.push({ label: 'Period', value: formatPeriod(body.orbitalPeriodDays) });
    }
    if (body.discoveryYear !== undefined) {
      rows.push({ label: 'Discovered', value: `${body.discoveryYear}` });
    }
    return rows;
  });

  /** Everything computed from the measurements above rather than observed directly. */
  readonly derived = computed<readonly CardRow[]>(() => {
    const body = this.body();
    const rows: CardRow[] = [{ label: 'Class', value: PLANET_CLASS_LABELS[body.appearance.planetClass] }];
    if (body.orbitalPeriodDays !== undefined && body.orbitalPeriodSource === 'derived') {
      rows.push({ label: 'Period', value: formatPeriod(body.orbitalPeriodDays) });
    }
    if (body.appearance.equilibriumTemperatureK !== null) {
      rows.push({
        label: 'Equilibrium temp.',
        value: formatTemperature(body.appearance.equilibriumTemperatureK),
      });
    }
    if (body.appearance.bulkDensityGramsPerCm3 !== null) {
      rows.push({
        label: 'Bulk density',
        value: formatDensity(body.appearance.bulkDensityGramsPerCm3),
      });
    }
    return rows;
  });

  /** The same distinction the detail panel draws, stated briefly enough for a card. */
  readonly provenance = computed(() => {
    const body = this.body();
    if (body.hasPhotography) {
      return 'Surface: NASA/ESA/USGS photography.';
    }
    return body.appearance.equilibriumTemperatureK === null
      ? 'Surface illustrated from measured size and mass. No host star in the catalogue, so no temperature could be derived.'
      : 'Surface illustrated from the measurements above. Not an observation — no image of this world exists.';
  });
}
