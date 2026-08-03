import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CameraPose, CameraRigController } from './camera-rig-controller';

function createRig(): { camera: THREE.PerspectiveCamera; controls: OrbitControls; rig: CameraRigController } {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 5);
  const controls = new OrbitControls(camera, document.createElement('canvas'));
  controls.target.set(0, 0, 0);
  const rig = new CameraRigController(camera, controls);
  return { camera, controls, rig };
}

function pose(position: [number, number, number], target: [number, number, number]): CameraPose {
  return { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) };
}

describe('CameraRigController', () => {
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let rig: CameraRigController;

  beforeEach(() => {
    ({ camera, controls, rig } = createRig());
  });

  it('is not animating and leaves controls enabled before any transition starts', () => {
    expect(rig.isAnimating).toBe(false);
    expect(controls.enabled).toBe(true);
  });

  it('flyTo starts an animation and disables the controls for its duration', () => {
    rig.flyTo(pose([10, 0, 0], [1, 1, 1]), 2);

    expect(rig.isAnimating).toBe(true);
    expect(controls.enabled).toBe(false);
  });

  it('interpolates the camera position/target to the symmetric midpoint at the halfway point of the duration', () => {
    rig.flyTo(pose([10, 0, 0], [2, 2, 2]), 2);

    rig.update(1); // halfway through the 2s duration -> t = 0.5, eased(0.5) = 0.5 (symmetric midpoint)

    expect(camera.position.x).toBeCloseTo(5, 6);
    expect(camera.position.z).toBeCloseTo(2.5, 6);
    expect(controls.target.x).toBeCloseTo(1, 6);
    expect(rig.isAnimating).toBe(true);
  });

  it('eases the transition using the cubic in-out curve, not linearly', () => {
    rig.flyTo(pose([8, 0, 0], [0, 0, 0]), 2);

    rig.update(0.5); // t = 0.25 of the duration elapsed

    // eased(0.25) = 4 * 0.25^3 = 0.0625 -> x = 0.5, well under the linear expectation of 25% (= 2).
    expect(camera.position.x).toBeCloseTo(0.5, 6);
    expect(camera.position.x).toBeLessThan(2);
  });

  it('calls lookAt toward the interpolated target on every update', () => {
    const lookAtSpy = vi.spyOn(camera, 'lookAt');
    rig.flyTo(pose([10, 0, 0], [2, 2, 2]), 2);

    rig.update(1);

    expect(lookAtSpy).toHaveBeenCalledWith(controls.target);
  });

  it('reaches the exact target pose, re-enables controls, and fires onComplete exactly once when the duration elapses', () => {
    const onComplete = vi.fn();
    rig.flyTo(pose([10, 0, 0], [2, 2, 2]), 2, onComplete);

    rig.update(1); // halfway
    expect(rig.isAnimating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    rig.update(1); // reaches the end exactly

    expect(camera.position.x).toBeCloseTo(10, 9);
    expect(camera.position.y).toBeCloseTo(0, 9);
    expect(camera.position.z).toBeCloseTo(0, 9);
    expect(controls.target.x).toBeCloseTo(2, 9);
    expect(rig.isAnimating).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);

    rig.update(1); // no active tween anymore -> no further calls, no throw
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('clamps overshooting deltas so the camera never travels past the destination pose', () => {
    const onComplete = vi.fn();
    rig.flyTo(pose([10, 0, 0], [2, 2, 2]), 2, onComplete);

    rig.update(100); // way more than the whole duration in a single frame

    expect(camera.position.x).toBeCloseTo(10, 9);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('update() is a no-op while no transition is in flight', () => {
    expect(() => rig.update(1)).not.toThrow();
    expect(camera.position.x).toBeCloseTo(0, 9);
    expect(camera.position.y).toBeCloseTo(0, 9);
    expect(camera.position.z).toBeCloseTo(5, 9);
    expect(controls.target.x).toBeCloseTo(0, 9);
    expect(controls.target.y).toBeCloseTo(0, 9);
    expect(controls.target.z).toBeCloseTo(0, 9);
    expect(rig.isAnimating).toBe(false);
  });

  it('clones the pose passed to flyTo, so mutating the caller-owned vectors afterward does not affect the transition', () => {
    const to = pose([10, 0, 0], [2, 2, 2]);
    rig.flyTo(to, 2);

    to.position.set(999, 999, 999);
    to.target.set(999, 999, 999);

    rig.update(2);

    expect(camera.position.x).toBeCloseTo(10, 9);
    expect(controls.target.x).toBeCloseTo(2, 9);
  });

  it('starting a new flyTo mid-transition replaces the old one, using the current interpolated pose as the new start', () => {
    const firstOnComplete = vi.fn();
    const secondOnComplete = vi.fn();

    rig.flyTo(pose([10, 0, 0], [0, 0, 0]), 2, firstOnComplete);
    rig.update(1); // halfway through the first tween: camera.position.x is now 5

    const midPositionX = camera.position.x;
    expect(midPositionX).toBeCloseTo(5, 6);

    rig.flyTo(pose([0, 20, 0], [0, 0, 0]), 1, secondOnComplete);
    // The new tween's "from" should be wherever the camera actually was, not the first tween's target.
    rig.update(1); // completes the second (1s) tween

    expect(camera.position.x).toBeCloseTo(0, 9);
    expect(camera.position.y).toBeCloseTo(20, 9);
    expect(firstOnComplete).not.toHaveBeenCalled();
    expect(secondOnComplete).toHaveBeenCalledTimes(1);
    expect(rig.isAnimating).toBe(false);
  });

  it('setImmediate jumps the camera/target with no easing and without requiring update()', () => {
    rig.setImmediate(pose([3, 4, 5], [1, 1, 1]));

    expect(camera.position.toArray()).toEqual([3, 4, 5]);
    expect(controls.target.toArray()).toEqual([1, 1, 1]);
    expect(rig.isAnimating).toBe(false);
  });

  it('setImmediate points the camera at the new target', () => {
    const lookAtSpy = vi.spyOn(camera, 'lookAt');

    rig.setImmediate(pose([3, 4, 5], [1, 1, 1]));

    expect(lookAtSpy).toHaveBeenCalledWith(new THREE.Vector3(1, 1, 1));
  });

  it('treats a zero-second duration as effectively instantaneous on the next update, without dividing by zero', () => {
    const onComplete = vi.fn();
    rig.flyTo(pose([10, 0, 0], [2, 2, 2]), 0, onComplete);

    rig.update(0.001);

    expect(Number.isFinite(camera.position.x)).toBe(true);
    expect(camera.position.x).toBeCloseTo(10, 9);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
