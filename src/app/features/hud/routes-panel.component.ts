import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { formatParsecs } from '../../shared/format/quantity';

/** A star offered for one of the two fields, as the panel needs to show it. */
export interface RouteStarOption {
  readonly id: number;
  readonly name: string;
  readonly subtitle: string;
}

/** What the scene worked out, once it has been asked. */
export interface RouteResult {
  /** The chain, departure first. Empty when there is no route at the range asked for. */
  readonly stars: readonly { id: number; name: string }[];
  readonly totalPc: number;
  /** The shortest range that would open a route, where none was found at the one asked for. */
  readonly neededRangePc: number | null;
}

export interface RouteRequest {
  readonly fromId: number;
  readonly toId: number;
  readonly rangePc: number;
}

/** Which end of the journey a query is for. */
type Field = 'from' | 'to';

/**
 * Departure, destination, range, and the chain between them.
 *
 * The one genuinely two-sided tool in the instrument, and the reason the range lives here
 * rather than beside the layer toggle that draws the graph: the number that decides which
 * crossings are possible is the same number in both places, and a control is easier to trust
 * where its consequence is printed.
 *
 * Presentational. It knows how to ask; the scene knows the catalogue and does the walking.
 */
@Component({
  selector: 'app-routes-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      <div class="grid gap-2 sm:grid-cols-2">
        @for (field of fields; track field) {
          <div class="relative">
            <label [for]="'route-' + field" class="type-label text-muted">{{ field === 'from' ? 'Departure' : 'Destination' }}</label>
            <input
              [id]="'route-' + field"
              type="text"
              autocomplete="off"
              [value]="text(field)"
              [placeholder]="field === 'from' ? 'From this system' : 'Search a star'"
              (input)="onInput(field, $event)"
              (keydown.escape)="closeOptions()"
              class="hud-surface mt-1 w-full px-2.5 py-1.5 text-sm text-text caret-accent placeholder:text-muted focus:border-accent focus:outline-none"
            />
            @if (open() === field && options().length) {
              <ul class="hud-surface absolute bottom-full left-0 z-10 mb-1 max-h-48 w-full overflow-y-auto divide-y divide-border/25">
                @for (option of options(); track option.id) {
                  <li>
                    <button
                      type="button"
                      (click)="choose(field, option)"
                      class="flex w-full items-baseline gap-3 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/8 focus-visible:bg-accent/12 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
                    >
                      <span class="min-w-0 flex-1 truncate text-sm text-text">{{ option.name }}</span>
                      <span class="type-label shrink-0 truncate text-muted">{{ option.subtitle }}</span>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>

      <div class="flex items-center gap-3">
        <label for="route-range" class="type-label shrink-0 text-muted">Jump range</label>
        <input
          id="route-range"
          type="range"
          [min]="minRangePc"
          [max]="maxRangePc"
          step="0.1"
          [value]="rangePc()"
          (input)="onRange($event)"
          class="h-1 min-w-0 flex-1 appearance-none rounded-none bg-border accent-accent"
        />
        <output for="route-range" class="w-20 shrink-0 text-right text-sm text-accent tabular-nums">{{ rangeLabel() }}</output>
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          [disabled]="!canPlot()"
          (click)="plot()"
          class="type-label border border-border/60 px-3 py-1.5 text-muted transition-colors enabled:hover:border-accent/70 enabled:hover:text-accent disabled:opacity-40 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
        >
          Plot route
        </button>
        @if (result(); as plotted) {
          @if (plotted.stars.length) {
            <p data-testid="route-summary" class="text-sm text-text tabular-nums">
              {{ plotted.stars.length - 1 }} {{ plotted.stars.length === 2 ? 'jump' : 'jumps' }} <span class="text-muted">·</span> {{ format(plotted.totalPc) }}
            </p>
          } @else {
            <p data-testid="route-summary" class="text-sm text-muted">
              No route at this range.
              @if (plotted.neededRangePc !== null) {
                <button
                  type="button"
                  (click)="raiseTo(plotted.neededRangePc)"
                  class="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent focus-visible:outline-1 focus-visible:outline-accent"
                >
                  {{ format(plotted.neededRangePc) }} would reach.
                </button>
              } @else {
                Nothing in the catalogue bridges the gap.
              }
            </p>
          }
        }
      </div>

      @if (result()?.stars?.length) {
        <ol data-testid="route-steps" class="hud-surface divide-y divide-border/25">
          @for (step of result()!.stars; track step.id; let i = $index) {
            <li>
              <button
                type="button"
                (click)="starSelected.emit(step.id)"
                class="flex w-full items-baseline gap-3 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/8 focus-visible:bg-accent/12 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
              >
                <span class="type-label w-6 shrink-0 text-muted tabular-nums">{{ i + 1 }}</span>
                <span class="min-w-0 flex-1 truncate text-sm text-text">{{ step.name }}</span>
              </button>
            </li>
          }
        </ol>
      }
    </div>
  `
})
export class RoutesPanelComponent {
  /** Whatever the scene found for the last query it was given. */
  readonly result = input<RouteResult | null>(null);
  /** Matches for the field currently being typed into, ranked by the scene. */
  readonly options = input<readonly RouteStarOption[]>([]);
  /** The star the view is currently inside, offered as the departure without typing. */
  readonly currentStar = input<RouteStarOption | null>(null);

  readonly queryChange = output<string>();
  readonly routeRequested = output<RouteRequest>();
  readonly starSelected = output<number>();
  /** The graph is drawn at whatever range this panel is set to, so the scene follows it. */
  readonly rangeChange = output<number>();

  readonly fields: readonly Field[] = ['from', 'to'];
  /** A tenth of a parsec is finer than the catalogue's own distances are known to. */
  readonly minRangePc = 0.5;
  /** Beyond this the graph is a solid sheet of lines and every pair of stars is connected. */
  readonly maxRangePc = 8;

  readonly rangePc = signal(3);
  readonly open = signal<Field | null>(null);

  private readonly chosen = signal<Record<Field, RouteStarOption | null>>({ from: null, to: null });
  private readonly typed = signal<Record<Field, string>>({ from: '', to: '' });

  /** Departure falls back to wherever the view already is, so one field is usually enough. */
  private readonly departure = computed(() => this.chosen().from ?? this.currentStar());

  readonly canPlot = computed(() => this.departure() !== null && this.chosen().to !== null);
  readonly rangeLabel = computed(() => formatParsecs(this.rangePc()));

  text(field: Field): string {
    return this.chosen()[field]?.name ?? this.typed()[field];
  }

  format(distancePc: number): string {
    return formatParsecs(distancePc);
  }

  onInput(field: Field, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.typed.update((current) => ({ ...current, [field]: value }));
    // Typing over a chosen star un-chooses it: the field says what it will be searched for.
    this.chosen.update((current) => ({ ...current, [field]: null }));
    this.open.set(field);
    this.queryChange.emit(value);
  }

  choose(field: Field, option: RouteStarOption): void {
    this.chosen.update((current) => ({ ...current, [field]: option }));
    this.closeOptions();
  }

  closeOptions(): void {
    this.open.set(null);
    this.queryChange.emit('');
  }

  onRange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.rangePc.set(value);
    this.rangeChange.emit(value);
  }

  raiseTo(rangePc: number): void {
    // Rounded up to the control's own step, so the number shown is one it can actually hold —
    // and up rather than down, since down would land just short of the crossing it names.
    const stepped = Math.min(this.maxRangePc, Math.ceil(rangePc * 10) / 10);
    this.rangePc.set(stepped);
    this.rangeChange.emit(stepped);
    this.plot();
  }

  plot(): void {
    const from = this.departure();
    const to = this.chosen().to;
    if (from && to) {
      this.routeRequested.emit({ fromId: from.id, toId: to.id, rangePc: this.rangePc() });
    }
  }
}
