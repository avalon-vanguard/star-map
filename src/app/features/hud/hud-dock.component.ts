import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, input, OnInit, output, signal, viewChild } from '@angular/core';

import { SearchComponent } from '../search/search.component';

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

/** Which layers the scene draws. Every one is a real object in the scene, toggled by visibility. */
export interface HudDisplay {
  readonly labels: boolean;
  readonly orbits: boolean;
  readonly grid: boolean;
  readonly deepSky: boolean;
  readonly sky: boolean;
}

export const DEFAULT_HUD_DISPLAY: HudDisplay = { labels: true, orbits: true, grid: true, deepSky: true, sky: true };

const DISPLAY_LAYERS: readonly { key: keyof HudDisplay; label: string }[] = [
  { key: 'labels', label: 'Labels' },
  { key: 'orbits', label: 'Orbits' },
  { key: 'grid', label: 'Grid' },
  { key: 'deepSky', label: 'Deep sky' },
  { key: 'sky', label: 'Sky' }
];

export type DockTab = 'search' | 'readout' | 'display';

const TAB_LABELS: Record<DockTab, string> = { search: 'Search', readout: 'Readout', display: 'Display' };

/** Tailwind's `sm` breakpoint: below it the dock is a bare tab strip and its panel is a sheet. */
const WIDE_VIEWPORT = '(min-width: 640px)';
/** One live query, read on every pointer-down, rather than a new MediaQueryList per read. */
const wideViewportQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_VIEWPORT) : null;

function isWideViewport(): boolean {
  return wideViewportQuery?.matches ?? true;
}

/**
 * The instrument's dock: one rail across the bottom of the viewport carrying every tool and
 * readout, so the top of the screen keeps only the scale ladder and the nameplate.
 *
 * The tab strip is pinned to the bottom edge and never moves; whichever panel is open grows
 * upward from it. That is why the search field sits at the *bottom* of its panel with the
 * results above — the thing being typed into stays put while the list grows.
 *
 * `null` for the active tab is a real state, not an error: the strip alone. It is the default
 * below `sm`, where the panel would cover most of the scene, and wherever there is no readout
 * to show by default. Purely presentational: readouts and layer state arrive as inputs, the
 * only things it emits are layer toggles.
 */
@Component({
  selector: 'app-hud-dock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchComponent],
  host: { class: 'pointer-events-none fixed inset-x-2 bottom-2 z-20 block font-body sm:inset-x-6 sm:bottom-6' },
  template: `
    <div class="pointer-events-auto flex flex-col items-start">
      @if (activeTab(); as tab) {
        <!-- Switching tabs remounts the panel and replays its acquire wipe: a new readout
             locking on, once per switch, never per keystroke. -->
        @switch (tab) {
          @case ('search') {
            <section id="dock-panel-search" role="tabpanel" aria-labelledby="dock-tab-search" class="hud-acquire mb-2 w-full max-w-xl">
              <app-search (picked)="onPicked()" />
            </section>
          }
          @case ('readout') {
            <section id="dock-panel-readout" role="tabpanel" aria-labelledby="dock-tab-readout" class="hud-acquire hud-brackets hud-surface mb-2 w-full max-w-lg px-4 py-3">
              <p class="type-label text-muted">{{ eyebrow() }}</p>
              <p data-testid="hud-title" class="mt-1 text-lg font-bold tracking-[0.04em] text-text uppercase">{{ title() }}</p>
              @if (subtitle()) {
                <p class="mt-0.5 text-xs text-muted">{{ subtitle() }}</p>
              }
              @if (readouts().length) {
                <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                  @for (readout of readouts(); track readout.label) {
                    <div>
                      <dt class="type-label text-muted">{{ readout.label }}@if (readout.derived) {<span class="text-accent/80" aria-hidden="true">*</span>}</dt>
                      <dd class="mt-0.5 text-sm text-text tabular-nums">{{ readout.value }}</dd>
                    </div>
                  }
                </dl>
              }
              @if (note() || hasDerived()) {
                <p class="mt-3 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted">@if (hasDerived()) {<span class="text-accent/80">*</span> Derived, not catalogued. }{{ note() }}</p>
              }
            </section>
          }
          @case ('display') {
            <section id="dock-panel-display" role="tabpanel" aria-labelledby="dock-tab-display" class="hud-acquire hud-brackets hud-surface mb-2 w-full max-w-lg px-4 py-3">
              <p class="type-label text-muted">Layers</p>
              <div class="mt-2 flex flex-wrap gap-2">
                @for (layer of layers; track layer.key) {
                  <button
                    type="button"
                    [attr.aria-pressed]="isOn(layer.key)"
                    (click)="toggleLayer(layer.key)"
                    class="type-label flex items-center gap-2 border px-3 py-1.5 transition-colors focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
                    [class]="isOn(layer.key) ? 'border-accent/60 bg-accent/12 text-accent hover:bg-accent/18' : 'border-border/60 text-muted hover:border-border hover:text-text'"
                  >
                    <!-- The state mark: a filled tick when the layer is drawn, hollow when it is not. -->
                    <span aria-hidden="true" class="h-1.5 w-1.5 border border-current" [class.bg-current]="isOn(layer.key)"></span>
                    {{ layer.label }}
                  </button>
                }
              </div>
            </section>
          }
        }
      }

      <div class="hud-brackets hud-surface flex w-full items-stretch">
        <div role="tablist" aria-label="Dock" class="flex items-stretch divide-x divide-border/40">
          @for (tab of tabs(); track tab) {
            <button
              type="button"
              role="tab"
              [id]="'dock-tab-' + tab"
              [attr.aria-selected]="activeTab() === tab"
              [attr.aria-controls]="activeTab() === tab ? 'dock-panel-' + tab : null"
              (click)="toggleTab(tab)"
              class="type-eyebrow px-3 py-2 transition-colors focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent sm:px-4"
              [class]="activeTab() === tab ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-accent/8 hover:text-accent'"
            >
              {{ tabLabel(tab) }}
            </button>
          }
        </div>
        @if (range()) {
          <p class="ml-auto flex items-baseline gap-2 border-l border-border/40 px-3 py-2 sm:px-4">
            <span class="type-label text-muted">Range</span>
            <span class="text-sm text-accent tabular-nums">{{ range() }}</span>
          </p>
        }
      </div>
    </div>
  `
})
export class HudDockComponent implements OnInit {
  /** Readout panel contents. An empty title means there is nothing to read out, and no tab for it. */
  readonly eyebrow = input('');
  readonly title = input('');
  readonly subtitle = input('');
  readonly readouts = input<readonly HudReadout[]>([]);
  /** Standing caveat for the current view, e.g. that galactic structure is a model. */
  readonly note = input('');
  /** Camera range, pre-formatted by the scene, which is the only thing that knows the units. */
  readonly range = input('');
  /** Layer state; `null` means the surface has no layers to toggle and no Display tab. */
  readonly display = input<HudDisplay | null>(null);
  /** Which panel is open on a wide viewport when the dock mounts. */
  readonly defaultTab = input<DockTab | null>(null);

  readonly displayChange = output<HudDisplay>();

  readonly layers = DISPLAY_LAYERS;
  readonly hasDerived = computed(() => this.readouts().some((readout) => readout.derived));
  readonly tabs = computed<readonly DockTab[]>(() => [
    'search',
    ...(this.title() ? (['readout'] as const) : []),
    ...(this.display() ? (['display'] as const) : [])
  ]);

  readonly activeTab = signal<DockTab | null>(null);

  private readonly search = viewChild(SearchComponent);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnInit(): void {
    this.activeTab.set(isWideViewport() ? this.defaultTab() : null);
  }

  tabLabel(tab: DockTab): string {
    return TAB_LABELS[tab];
  }

  isOn(key: keyof HudDisplay): boolean {
    return this.display()?.[key] ?? false;
  }

  toggleTab(tab: DockTab): void {
    this.activeTab.set(this.activeTab() === tab ? null : tab);
  }

  toggleLayer(key: keyof HudDisplay): void {
    const current = this.display();
    if (current) {
      this.displayChange.emit({ ...current, [key]: !current[key] });
    }
  }

  onPicked(): void {
    // A result was chosen: the thing to look at is now the scene, so hand the panel back to the
    // readout where there is one, and fold the sheet away where there is not.
    this.activeTab.set(this.title() ? 'readout' : null);
  }

  /** `/` opens the search from anywhere, unless something else is already taking text. */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    event.preventDefault();
    this.activeTab.set('search');
    // The field only exists after the panel renders; defer the focus to after that pass.
    setTimeout(() => this.search()?.focus());
  }

  /** On a narrow viewport the panel is a sheet over the scene: tapping the scene folds it away. */
  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (this.activeTab() && !isWideViewport() && !this.host.nativeElement.contains(event.target as Node)) {
      this.activeTab.set(null);
    }
  }
}
