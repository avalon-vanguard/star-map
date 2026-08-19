import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, it } from 'vitest';

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { StarLabelOverlay } from './star-label-overlay';

describe('StarLabelOverlay', () => {
  let scene: THREE.Scene;
  let overlay: StarLabelOverlay;
  let camera: THREE.PerspectiveCamera;

  /**
   * Every label element currently in the layer, in DOM order.
   *
   * `CSS2DRenderer` only attaches an element to its layer when it projects it, so the labels do
   * not exist in the DOM until something has been rendered — which is why this draws a frame
   * rather than reading straight off `domElement`.
   */
  function labels(): HTMLElement[] {
    overlay.render(camera);
    return [...overlay.domElement.querySelectorAll<HTMLElement>('.map-label')];
  }

  beforeEach(() => {
    scene = new THREE.Scene();
    overlay = new StarLabelOverlay(scene);
    overlay.setSize(800, 600);
    camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    camera.position.set(0, 0, 20);
    camera.updateMatrixWorld();
  });

  it('prints what a thing is under what it is called', () => {
    overlay.update([{ id: 1, name: 'Sirius', kind: 'System', x: 1, y: 2, z: 3 }]);

    const label = labels()[0];
    expect(label.querySelector('.map-label-name')?.textContent).toBe('Sirius');
    expect(label.querySelector('.map-label-kind')?.textContent).toBe('System');
  });

  it('prints the name alone when there is no type to give', () => {
    // The second line is optional, and an empty one would still cost its line height — which
    // over a screen of labels shifts every name off the point it is anchored to.
    overlay.update([{ id: 1, name: 'Sirius', x: 1, y: 2, z: 3 }]);

    expect(labels()[0].querySelector('.map-label-name')?.textContent).toBe('Sirius');
    expect(labels()[0].querySelector('.map-label-kind')).toBeNull();
  });

  it('places the label at the point it belongs to', () => {
    overlay.update([{ id: 7, name: 'Vega', kind: 'Star', x: 4, y: -5, z: 6 }]);

    const object = scene.children.find((child) => child.type === 'Object3D');
    expect(object?.position.toArray()).toEqual([4, -5, 6]);
  });

  it('touches the DOM only for labels that actually changed', () => {
    overlay.update([
      { id: 1, name: 'Sirius', kind: 'Star', x: 1, y: 0, z: 0 },
      { id: 2, name: 'Vega', kind: 'Star', x: 0, y: 1, z: 0 }
    ]);
    const sirius = labels()[0];

    overlay.update([
      { id: 1, name: 'Sirius', kind: 'Star', x: 1, y: 0, z: 0 },
      { id: 3, name: 'Altair', kind: 'Star', x: 0, y: 0, z: 1 }
    ]);

    // Same element instance: the label that stayed was not torn down and rebuilt.
    expect(labels()[0]).toBe(sirius);
    expect(labels().map((label) => label.querySelector('.map-label-name')?.textContent)).toEqual(['Sirius', 'Altair']);
  });

  it('drops every label when given none', () => {
    overlay.update([{ id: 1, name: 'Sirius', kind: 'Star', x: 1, y: 0, z: 0 }]);
    overlay.update([]);

    expect(labels()).toHaveLength(0);
  });

  it('hangs a label on the side it is told to, and can move it across', () => {
    overlay.update([{ id: 1, name: 'Sirius', kind: 'Star', x: 1, y: 0, z: 0, side: 'left' }]);
    const object = scene.children[0] as CSS2DObject;
    expect(labels()[0].classList.contains('map-label--left')).toBe(true);
    expect(object.center.x).toBe(1);

    overlay.update([{ id: 1, name: 'Sirius', kind: 'Star', x: 1, y: 0, z: 0, side: 'right' }]);
    expect(labels()[0].classList.contains('map-label--left')).toBe(false);
    expect(object.center.x).toBe(0);
  });

  it('brackets one selected point with the mark, moves it, and clears it', () => {
    overlay.setSelection({ x: 1, y: 2, z: 3 });
    overlay.setSelection({ x: 4, y: 5, z: 6 });
    overlay.render(camera);
    const marks = overlay.domElement.querySelectorAll('.map-select');
    expect(marks).toHaveLength(1);
    expect((scene.children[0] as THREE.Object3D).position.toArray()).toEqual([4, 5, 6]);

    overlay.setSelection(null);
    overlay.render(camera);
    expect(overlay.domElement.querySelectorAll('.map-select')).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });

  it('leaves nothing behind when disposed', () => {
    overlay.update([
      { id: 1, name: 'Sirius', kind: 'Star', x: 1, y: 0, z: 0 },
      { id: 'ngc:224', name: 'Andromeda', kind: 'GALAXY', x: 0, y: 1, z: 0 }
    ]);
    overlay.dispose();

    expect(labels()).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });
});
