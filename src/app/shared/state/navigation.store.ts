import { Injectable, signal } from '@angular/core';

export type ViewLevel = 'galaxy' | 'system';

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
