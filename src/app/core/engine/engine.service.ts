import { Injectable, NgZone } from '@angular/core';
import * as THREE from 'three/webgpu';

export type EngineTickCallback = (deltaSeconds: number, elapsedSeconds: number) => void;

/** Which projection the scene is drawn through. */
export type Projection = 'perspective' | 'orthographic';

/** Either camera, as everything downstream of the projection sees it. */
export type SceneCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/**
 * Owns the Three.js WebGPURenderer (with automatic WebGL2 fallback), the base scene/camera,
 * and the render loop. The loop always runs outside Angular's zone so per-frame work never
 * triggers change detection.
 *
 * Not provided at root: each canvas host component provides its own instance
 * (via its `providers` array) so independent scenes (e.g. galaxy/system vs. body detail)
 * never share a renderer.
 */
@Injectable()
export class EngineService {
  private readonly clock = new THREE.Clock(false);
  private readonly tickCallbacks = new Set<EngineTickCallback>();

  private canvas?: HTMLCanvasElement;
  private renderer?: THREE.WebGPURenderer;
  private scene?: THREE.Scene;
  private perspective?: THREE.PerspectiveCamera;
  /**
   * Built alongside the perspective one and kept in step with it, rather than made on demand:
   * the two share a position, an orientation and a depth range, and a camera that only exists
   * while it is being looked through is a camera whose state is always one swap out of date.
   */
  private orthographic?: THREE.OrthographicCamera;
  private projection: Projection = 'perspective';
  private running = false;

  constructor(private readonly ngZone: NgZone) {}

  get isInitialized(): boolean {
    return !!this.renderer;
  }

  getScene(): THREE.Scene {
    return this.requireInitialized(this.scene);
  }

  /** The camera the scene is currently drawn through. */
  getCamera(): SceneCamera {
    return this.projection === 'orthographic' ? this.requireInitialized(this.orthographic) : this.requireInitialized(this.perspective);
  }

  /**
   * The perspective camera, whichever is active. For the handful of places that need a field of
   * view to reason with — framing a system, sizing a star — and that go on meaning the same
   * thing in either projection because the sizes were tuned against this one.
   */
  getPerspectiveCamera(): THREE.PerspectiveCamera {
    return this.requireInitialized(this.perspective);
  }

  get currentProjection(): Projection {
    return this.projection;
  }

  /**
   * Switches projection, carrying the pose across. The orthographic frustum is sized to show
   * the same extent at `distanceToTarget` that the perspective camera showed from there, so the
   * swap changes how the scene is projected and not how much of it is in frame.
   */
  setProjection(projection: Projection, distanceToTarget: number): void {
    const perspective = this.requireInitialized(this.perspective);
    const orthographic = this.requireInitialized(this.orthographic);
    this.projection = projection;

    orthographic.zoom = 1;
    orthographic.position.copy(perspective.position);
    orthographic.quaternion.copy(perspective.quaternion);
    this.frameOrthographic(distanceToTarget);
  }

  /**
   * Sizes the orthographic frustum to show, at `distanceToTarget`, what the perspective camera
   * would show from there. Called every frame while that projection is active, which is what
   * makes the camera flights work through it: they move the camera, and the frame follows.
   *
   * The depth range is symmetric about the camera rather than starting in front of it. An
   * orthographic camera does not pull back as its frame grows, so at galactic framing the
   * backdrop shell and half the Milky Way lie behind its own plane and would be clipped away.
   * A parallel projection has linear depth, so the precision argument that makes a perspective
   * near plane worth guarding does not apply here.
   */
  frameOrthographic(distanceToTarget: number): void {
    const perspective = this.requireInitialized(this.perspective);
    const orthographic = this.requireInitialized(this.orthographic);
    const halfHeight = Math.max(distanceToTarget, 1e-6) * Math.tan((perspective.fov * Math.PI) / 360);
    orthographic.top = halfHeight;
    orthographic.bottom = -halfHeight;
    orthographic.left = -halfHeight * perspective.aspect;
    orthographic.right = halfHeight * perspective.aspect;
    orthographic.far = perspective.far;
    orthographic.near = -perspective.far;
    orthographic.updateProjectionMatrix();
  }

  /** Half the height of what is in frame at the target, in world units, under either camera. */
  visibleHalfHeight(distanceToTarget: number): number {
    if (this.projection === 'orthographic') {
      const orthographic = this.requireInitialized(this.orthographic);
      return (orthographic.top - orthographic.bottom) / (2 * orthographic.zoom);
    }
    return distanceToTarget * Math.tan((this.requireInitialized(this.perspective).fov * Math.PI) / 360);
  }

  getRenderer(): THREE.WebGPURenderer {
    return this.requireInitialized(this.renderer);
  }

  /**
   * Creates the renderer/scene/camera against the given canvas. Must be called once per canvas.
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;

    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    await this.renderer.init();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.perspective = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.perspective.position.set(0, 0, 5);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.orthographic.position.copy(this.perspective.position);

    const { width, height } = this.canvasSize();
    this.resize(width, height);
  }

  /**
   * Registers a callback invoked once per rendered frame, before the scene is drawn.
   * Returns an unsubscribe function.
   */
  onTick(callback: EngineTickCallback): () => void {
    this.tickCallbacks.add(callback);
    return () => this.tickCallbacks.delete(callback);
  }

  /**
   * Starts the render loop outside Angular's zone.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.clock.start();

    this.ngZone.runOutsideAngular(() => {
      this.requireInitialized(this.renderer).setAnimationLoop(() => this.tick());
    });
  }

  /**
   * Stops the render loop without disposing any resources.
   */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.clock.stop();
    this.renderer?.setAnimationLoop(null);
  }

  /**
   * Updates the camera aspect ratio and renderer drawing buffer size.
   */
  resize(width: number, height: number): void {
    if (!this.renderer || !this.perspective || !this.orthographic || width <= 0 || height <= 0) {
      return;
    }
    const aspect = width / height;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    // The orthographic frustum keeps its height and re-fits its width, so a window getting wider
    // shows more to the sides rather than magnifying what was already there.
    const halfHeight = (this.orthographic.top - this.orthographic.bottom) / 2;
    this.orthographic.left = -halfHeight * aspect;
    this.orthographic.right = halfHeight * aspect;
    this.orthographic.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /**
   * Stops the loop and releases GPU resources. Call when the canvas host is destroyed.
   */
  dispose(): void {
    this.stop();
    this.tickCallbacks.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.scene = undefined;
    this.perspective = undefined;
    this.orthographic = undefined;
    this.canvas = undefined;
  }

  private tick(): void {
    const deltaSeconds = this.clock.getDelta();
    const elapsedSeconds = this.clock.getElapsedTime();

    for (const callback of this.tickCallbacks) {
      callback(deltaSeconds, elapsedSeconds);
    }

    this.requireInitialized(this.renderer).render(this.requireInitialized(this.scene), this.getCamera());
  }

  private canvasSize(): { width: number; height: number } {
    const canvas = this.requireInitialized(this.canvas);
    return {
      width: canvas.clientWidth || 1,
      height: canvas.clientHeight || 1
    };
  }

  private requireInitialized<T>(value: T | undefined): T {
    if (value === undefined) {
      throw new Error('EngineService used before init() completed.');
    }
    return value;
  }
}
