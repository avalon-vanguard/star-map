import { Injectable, signal } from '@angular/core';

/**
 * The map's zoom levels, outermost first.
 *
 * `galactic` is the whole Milky Way; `galaxy` is the catalogued solar neighbourhood inside it
 * (the level the app opens on); `system` is one star's planets. The first two share a coordinate
 * space and are told apart by how far the camera has pulled back, so the scene reports which one
 * it is in rather than being commanded into it.
 */
export type ViewLevel = 'galactic' | 'galaxy' | 'system';

/**
 * App-wide navigation state: which zoom level is active and what's currently selected.
 * Scene components read these signals to drive rendering; UI (search, picking) writes to
 * them to trigger navigation.
 */
@Injectable({ providedIn: 'root' })
export class NavigationStore {
  readonly viewLevel = signal<ViewLevel>('galaxy');
  readonly selectedStarId = signal<number | null>(null);
  readonly selectedBodyId = signal<string | null>(null);

  selectStar(starId: number | null): void {
    this.selectedStarId.set(starId);
  }

  selectBody(bodyId: string | null): void {
    this.selectedBodyId.set(bodyId);
  }

  setViewLevel(viewLevel: ViewLevel): void {
    this.viewLevel.set(viewLevel);
  }
}
