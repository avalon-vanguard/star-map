import { Injectable, NgZone } from '@angular/core';
import * as THREE from 'three/webgpu';

export type EngineTickCallback = (deltaSeconds: number, elapsedSeconds: number) => void;

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
  private camera?: THREE.PerspectiveCamera;
  private running = false;

  constructor(private readonly ngZone: NgZone) {}

  get isInitialized(): boolean {
    return !!this.renderer;
  }

  getScene(): THREE.Scene {
    return this.requireInitialized(this.scene);
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.requireInitialized(this.camera);
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
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.camera.position.set(0, 0, 5);

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
    if (!this.renderer || !this.camera || width <= 0 || height <= 0) {
      return;
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
    this.camera = undefined;
    this.canvas = undefined;
  }

  private tick(): void {
    const deltaSeconds = this.clock.getDelta();
    const elapsedSeconds = this.clock.getElapsedTime();

    for (const callback of this.tickCallbacks) {
      callback(deltaSeconds, elapsedSeconds);
    }

    this.requireInitialized(this.renderer).render(this.requireInitialized(this.scene), this.requireInitialized(this.camera));
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
