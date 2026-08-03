import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Drives smooth camera-position/look-at tweens between two poses. Deliberately unaware of
 * parsecs vs. AU: the galaxy-to-system transition is built from two of these tweens (one per
 * unit space) with a "floating-origin" recenter — an instantaneous {@link setImmediate} jump
 * that swaps which group is visible and which unit scale the camera/controls operate in —
 * spliced in between them by the caller (`GalaxySystemSceneComponent`).
 */
export class CameraRigController {
  private active?: {
    from: CameraPose;
    to: CameraPose;
    duration: number;
    elapsed: number;
    onComplete?: () => void;
  };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: OrbitControls
  ) {}

  get isAnimating(): boolean {
    return !!this.active;
  }

  /** Starts (replacing any in-flight tween) an eased camera-pose animation. */
  flyTo(to: CameraPose, durationSeconds: number, onComplete?: () => void): void {
    this.controls.enabled = false;
    this.active = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to: { position: to.position.clone(), target: to.target.clone() },
      duration: Math.max(durationSeconds, 0.001),
      elapsed: 0,
      onComplete
    };
  }

  /**
   * Instantly places the camera/controls-target with no animation — the floating-origin
   * recenter jump performed right after swapping which unit space/group is visible.
   */
  setImmediate(pose: CameraPose): void {
    this.camera.position.copy(pose.position);
    this.controls.target.copy(pose.target);
    this.camera.lookAt(pose.target);
  }

  /** Advances any in-flight tween. Call once per rendered frame. */
  update(deltaSeconds: number): void {
    if (!this.active) {
      return;
    }

    this.active.elapsed += deltaSeconds;
    const t = Math.min(this.active.elapsed / this.active.duration, 1);
    const eased = easeInOutCubic(t);

    this.camera.position.lerpVectors(this.active.from.position, this.active.to.position, eased);
    this.controls.target.lerpVectors(this.active.from.target, this.active.to.target, eased);
    this.camera.lookAt(this.controls.target);

    if (t >= 1) {
      const { onComplete } = this.active;
      this.active = undefined;
      this.controls.enabled = true;
      onComplete?.();
    }
  }
}
