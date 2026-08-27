import * as THREE from 'three/webgpu';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export interface LabeledPoint {
  /** Numeric for HYG stars, string for catalog designations such as deep-sky objects. */
  id: number | string;
  name: string;
  /**
   * What sort of thing this is — `STAR`, `PLANET`, `NEBULA`, `ARM`. Printed under the name in
   * smaller, dimmer, wider-tracked capitals.
   *
   * A name on its own is ambiguous in a map that mixes scales: "Orion" is an arm, a nebula and a
   * constellation, and at a glance nothing distinguishes the label on one from the label on
   * another. The second line is what makes a label say what it is pointing at, not just what it
   * is called.
   */
  kind?: string;
  /**
   * Which side of the point the text hangs on. Right is the default; left is for a point close
   * to the right edge of the view, or one whose right-hand text would run into a neighbour's.
   */
  side?: LabelSide;
  /**
   * `ghost` is the quieter voice: a star outside the system the camera is in, named so its
   * direction can be read without leaving. Dimmer, and it can be selected.
   */
  tone?: LabelTone;
  /**
   * The star this label offers to fly to. Present makes the label a real button — focusable,
   * clickable, and the only labels the pointer can reach at all. Whether a given id is
   * selectable never changes between updates, so the element it needs is settled at creation.
   */
  selectStarId?: number;
  x: number;
  y: number;
  z: number;
}

export type LabelSide = 'left' | 'right';
export type LabelTone = 'normal' | 'ghost';

/** Where the selection mark sits, in the same scene units as the labels. */
export interface SelectionPoint {
  x: number;
  y: number;
  z: number;
}

function classesFor(point: Pick<LabeledPoint, 'side' | 'tone' | 'selectStarId'>): string {
  return [
    'map-label',
    point.side === 'left' ? 'map-label--left' : '',
    point.tone === 'ghost' ? 'map-label--ghost' : '',
    point.selectStarId === undefined ? '' : 'map-label--select',
    'whitespace-nowrap font-body'
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Renders DOM-based (CSS2D) name labels anchored to 3D star positions. Labels are added as
 * children of the main scene (so `CSS2DRenderer` can project them with the same camera) and
 * diffed against the previous frame's set so the DOM is only touched when the visible set
 * of stars actually changes, not every frame.
 */
export class StarLabelOverlay {
  readonly domElement: HTMLElement;

  private readonly cssRenderer = new CSS2DRenderer();
  private readonly labelObjects = new Map<number | string, CSS2DObject>();
  private selection?: CSS2DObject;

  constructor(
    private readonly scene: THREE.Scene,
    /** Called with the star a selectable label names, when it is clicked or keyed. */
    private readonly onSelectStar?: (starId: number) => void
  ) {
    this.cssRenderer.domElement.classList.add('star-label-layer');
    this.domElement = this.cssRenderer.domElement;
  }

  setSize(width: number, height: number): void {
    this.cssRenderer.setSize(width, height);
  }

  /**
   * Shows exactly these labels, adding/removing DOM elements only for a changed set.
   *
   * A label that is already up is repositioned rather than left where it was: stars never move,
   * but planets do, and a system's labels would otherwise stay pinned to wherever each body
   * happened to be when its label first appeared.
   */
  update(points: readonly LabeledPoint[]): void {
    const idsToShow = new Set(points.map((point) => point.id));

    for (const [id, object] of this.labelObjects) {
      if (!idsToShow.has(id)) {
        this.removeLabel(id, object);
      }
    }

    for (const point of points) {
      const existing = this.labelObjects.get(point.id);
      if (existing) {
        existing.position.set(point.x, point.y, point.z);
        this.applyPresentation(existing, point);
      } else {
        this.addLabel(point);
      }
    }
  }

  /**
   * Moves one label that is already up, without going through `update`. For labels whose place
   * is fixed relative to the camera rather than to anything in the scene: they have to be
   * recomputed every frame, and rebuilding the whole label set at that rate would throw away
   * the diffing that keeps the DOM still.
   */
  moveLabel(id: number | string, x: number, y: number, z: number): void {
    this.labelObjects.get(id)?.position.set(x, y, z);
  }

  /**
   * Marks the selected object in the scene: two thin arcs bracketing the point, the one thing
   * borrowed from the ARK's control disc. `null` clears it. Kept out of `update` because it is
   * a different rhythm — labels change on their own cadence, the mark follows a moving body
   * every frame.
   */
  setSelection(point: SelectionPoint | null): void {
    if (!point) {
      if (this.selection) {
        this.scene.remove(this.selection);
        this.selection.element.remove();
        this.selection = undefined;
      }
      return;
    }
    if (!this.selection) {
      const element = document.createElement('div');
      element.className = 'map-select';
      element.setAttribute('aria-hidden', 'true');
      this.selection = new CSS2DObject(element);
      this.scene.add(this.selection);
    }
    this.selection.position.set(point.x, point.y, point.z);
  }

  render(camera: THREE.Camera): void {
    this.cssRenderer.render(this.scene, camera);
  }

  dispose(): void {
    for (const [id, object] of this.labelObjects) {
      this.removeLabel(id, object);
    }
    this.setSelection(null);
  }

  private addLabel(point: LabeledPoint): void {
    // A selectable label is a real button, so it is reachable by keyboard and announced as an
    // action rather than as text that happens to respond to a click.
    const element = document.createElement(point.selectStarId === undefined ? 'div' : 'button');
    if (point.selectStarId !== undefined) {
      const starId = point.selectStarId;
      (element as HTMLButtonElement).type = 'button';
      // Read out as a sentence rather than as the two lines run together — the name and the
      // distance are adjacent spans, so the default accessible name is "Sirius2.64 pc" — and
      // said as the action it is, since nothing else on screen says these labels are doors.
      element.setAttribute('aria-label', `Go to ${point.name}${point.kind ? `, ${point.kind} away` : ''}`);
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        this.onSelectStar?.(starId);
      });
    }
    // Classes assigned directly since this element lives outside Angular's view encapsulation
    // (see the class comment above). The offset and leader line live in `.map-label` itself:
    // CSS2DRenderer rewrites this element's inline transform every frame, so a translate here
    // would be overwritten — the margin is the offset it cannot touch.
    element.className = classesFor(point);

    const name = document.createElement('span');
    name.className = 'map-label-name';
    name.textContent = point.name;
    element.appendChild(name);

    if (point.kind) {
      const kind = document.createElement('span');
      kind.className = 'map-label-kind';
      kind.textContent = point.kind;
      element.appendChild(kind);
    }

    const object = new CSS2DObject(element);
    // Anchor the label's near edge at the point, vertically centred. The default center of
    // (0.5, 0.5) makes CSS2DRenderer emit translate(-50%,-50%), keeping the box centred on the
    // star — under which `.map-label`'s margin offset only nudges the centred box sideways and
    // the leader line points at empty space half the label's width from the star.
    this.applyPresentation(object, point);
    object.position.set(point.x, point.y, point.z);
    this.scene.add(object);
    this.labelObjects.set(point.id, object);
  }

  /** Right-hand text hangs its left edge on the point; left-hand text hangs its right edge. */
  private applyPresentation(object: CSS2DObject, point: LabeledPoint): void {
    object.center.set(point.side === 'left' ? 1 : 0, 0.5);
    const wanted = classesFor(point);
    if (object.element.className !== wanted) {
      object.element.className = wanted;
    }
  }

  private removeLabel(id: number | string, object: CSS2DObject): void {
    this.scene.remove(object);
    object.element.remove();
    this.labelObjects.delete(id);
  }
}
