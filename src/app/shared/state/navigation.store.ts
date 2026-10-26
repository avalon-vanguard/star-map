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
  /**
   * The deep-sky object the view is to turn toward. A request rather than a selection: the scene
   * clears it once it has turned, so asking for the same object again turns the view again.
   */
  readonly deepSkyTarget = signal<string | null>(null);

  selectStar(starId: number | null): void {
    this.selectedStarId.set(starId);
  }

  selectBody(bodyId: string | null): void {
    this.selectedBodyId.set(bodyId);
  }

  lookAtDeepSky(deepSkyId: string | null): void {
    // The view leaves any system to turn, so no star stays selected. The body route keeps its
    // host selected, and the map, back from it, flew into the host's system and dropped the request.
    if (deepSkyId !== null) {
      this.selectedStarId.set(null);
    }
    this.deepSkyTarget.set(deepSkyId);
  }

  setViewLevel(viewLevel: ViewLevel): void {
    this.viewLevel.set(viewLevel);
  }
}
