import { NgZone } from '@angular/core';
import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, it } from 'vitest';

import { EngineService } from './engine.service';

/**
 * The projection half of the engine, which is the half that can be tested without a GPU: no
 * renderer is created, the two cameras are placed by hand, and what is asserted is the
 * arithmetic that keeps them showing the same thing.
 */
function engineWithCameras(): { engine: EngineService; perspective: THREE.PerspectiveCamera; orthographic: THREE.OrthographicCamera } {
  const engine = new EngineService({ runOutsideAngular: (fn: () => unknown) => fn() } as unknown as NgZone);
  const perspective = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  // The two cameras are private, because nothing outside should choose between them by hand.
  Object.assign(engine as unknown as Record<string, unknown>, { perspective, orthographic });
  return { engine, perspective, orthographic };
}

/** Half the height of what a perspective camera frames at `distance`, in world units. */
function perspectiveHalfHeight(camera: THREE.PerspectiveCamera, distance: number): number {
  return distance * Math.tan((camera.fov * Math.PI) / 360);
}

describe('EngineService projection', () => {
  let engine: EngineService;
  let perspective: THREE.PerspectiveCamera;
  let orthographic: THREE.OrthographicCamera;

  beforeEach(() => {
    ({ engine, perspective, orthographic } = engineWithCameras());
  });

  it('draws through the perspective camera until told otherwise', () => {
    expect(engine.currentProjection).toBe('perspective');
    expect(engine.getCamera()).toBe(perspective);
  });

  it('frames the same extent through either camera, which is the point of the swap', () => {
    perspective.position.set(0, 0, 200);

    engine.setProjection('orthographic', 200);

    expect(engine.getCamera()).toBe(orthographic);
    expect(engine.visibleHalfHeight(200)).toBeCloseTo(perspectiveHalfHeight(perspective, 200), 6);
    // And as wide as the frame is, not as wide as it is tall.
    expect(orthographic.right - orthographic.left).toBeCloseTo((orthographic.top - orthographic.bottom) * perspective.aspect, 6);
  });

  it('carries the pose across, so the swap changes the projection and not the view', () => {
    perspective.position.set(3, 4, 12);
    perspective.lookAt(0, 0, 0);

    engine.setProjection('orthographic', 13);

    expect(orthographic.position.toArray()).toEqual(perspective.position.toArray());
    expect(orthographic.quaternion.toArray()).toEqual(perspective.quaternion.toArray());
  });

  it('sees behind itself, because a parallel camera does not back away from what it frames', () => {
    engine.setProjection('orthographic', 100);

    // A perspective camera pulls back as its frame grows and leaves the scene in front of it. An
    // orthographic one does not move at all, so half the Galaxy ends up behind its own plane —
    // and a near plane in front would clip it away. Parallel depth is linear, so the precision
    // that a perspective near plane is guarding for does not apply.
    expect(orthographic.near).toBe(-perspective.far);
    expect(orthographic.far).toBe(perspective.far);
  });

  it('goes back, and hands out the perspective camera again', () => {
    engine.setProjection('orthographic', 100);
    engine.setProjection('perspective', 100);

    expect(engine.currentProjection).toBe('perspective');
    expect(engine.getCamera()).toBe(perspective);
    expect(engine.visibleHalfHeight(100)).toBeCloseTo(perspectiveHalfHeight(perspective, 100), 6);
  });

  it('reports the extent the orthographic camera is zoomed to, not the one it was built at', () => {
    engine.setProjection('orthographic', 100);
    const framed = engine.visibleHalfHeight(100);

    orthographic.zoom = 2;

    // Zoomed in twice: half as much in frame. Distance says nothing about it, which is why
    // nothing downstream may read the camera's distance under this projection.
    expect(engine.visibleHalfHeight(100)).toBeCloseTo(framed / 2, 6);
    expect(engine.visibleHalfHeight(999)).toBeCloseTo(framed / 2, 6);
  });

  it('never divides by a camera sitting on its own target', () => {
    expect(() => engine.setProjection('orthographic', 0)).not.toThrow();
    expect(Number.isFinite(orthographic.top)).toBe(true);
  });

  it('widens rather than magnifies when the window gets wider', () => {
    engine.setProjection('orthographic', 100);
    const height = orthographic.top - orthographic.bottom;

    // No renderer, so resize returns early — the frustum is re-fitted by hand the same way.
    orthographic.left = (-height / 2) * (21 / 9);
    orthographic.right = (height / 2) * (21 / 9);

    expect(orthographic.top - orthographic.bottom).toBeCloseTo(height, 6);
    expect(orthographic.right - orthographic.left).toBeCloseTo(height * (21 / 9), 6);
  });
});
