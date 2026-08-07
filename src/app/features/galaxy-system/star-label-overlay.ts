import * as THREE from 'three/webgpu';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export interface LabeledPoint {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
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
  private readonly labelObjects = new Map<number, CSS2DObject>();

  constructor(private readonly scene: THREE.Scene) {
    this.cssRenderer.domElement.classList.add('star-label-layer');
    this.domElement = this.cssRenderer.domElement;
  }

  setSize(width: number, height: number): void {
    this.cssRenderer.setSize(width, height);
  }

  /** Shows exactly these labels, adding/removing DOM elements only for a changed set. */
  update(points: readonly LabeledPoint[]): void {
    const idsToShow = new Set(points.map((point) => point.id));

    for (const [id, object] of this.labelObjects) {
      if (!idsToShow.has(id)) {
        this.removeLabel(id, object);
      }
    }

    for (const point of points) {
      if (!this.labelObjects.has(point.id)) {
        this.addLabel(point);
      }
    }
  }

  render(camera: THREE.Camera): void {
    this.cssRenderer.render(this.scene, camera);
  }

  dispose(): void {
    for (const [id, object] of this.labelObjects) {
      this.removeLabel(id, object);
    }
  }

  private addLabel(point: LabeledPoint): void {
    const element = document.createElement('div');
    // Tailwind utility classes assigned directly since this element lives outside Angular's
    // view encapsulation (see the class comment above) rather than through a component template.
    //
    // The offset is a margin rather than a `translate-*` utility because `CSS2DRenderer` writes
    // its own `transform` to the inline style every frame, which would win over any class. The
    // `::before` hairline is the leader line back to the star the name belongs to — without it a
    // margin-shifted label just floats near a point instead of pointing at it.
    element.className =
      "relative ml-3 whitespace-nowrap font-body text-[11px] tracking-[0.08em] text-accent uppercase [text-shadow:0_0_6px_var(--color-void),0_0_3px_var(--color-void)] before:absolute before:top-1/2 before:-left-3 before:h-px before:w-2.5 before:bg-accent/60 before:content-['']";
    element.textContent = point.name;

    const object = new CSS2DObject(element);
    object.position.set(point.x, point.y, point.z);
    this.scene.add(object);
    this.labelObjects.set(point.id, object);
  }

  private removeLabel(id: number, object: CSS2DObject): void {
    this.scene.remove(object);
    object.element.remove();
    this.labelObjects.delete(id);
  }
}
