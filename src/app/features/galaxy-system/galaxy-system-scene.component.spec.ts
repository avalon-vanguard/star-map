import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataLoaderService, StarField } from '../../core/data/data-loader.service';
import { EngineService, EngineTickCallback } from '../../core/engine/engine.service';
import { BodyRecord } from '../../shared/models/body.model';
import { DeepSkyRecord } from '../../shared/models/deepsky.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { NavigationStore } from '../../shared/state/navigation.store';
import { GalaxySystemSceneComponent } from './galaxy-system-scene.component';

// jsdom does not implement ResizeObserver; the component only uses it to react to real
// layout changes, which never happen in this headless test.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const SUN: StarRecord = { id: 0, name: 'Sol', x: 0, y: 0, z: 0, magnitude: -26.7, spectralType: 'G2V', colorIndex: 0.656 };
const ALPHA_CENTAURI: StarRecord = { id: 1, name: 'Alpha Centauri', x: 1.34, y: 0, z: 0, magnitude: 4.4, spectralType: 'G2V', colorIndex: 0.7 };
const PROXIMA: StarRecord = { id: 2, name: 'Proxima Centauri', x: 0, y: 1.3, z: 0, magnitude: 11.1, spectralType: 'M5V', colorIndex: 1.8 };

const STARS: StarRecord[] = [SUN, ALPHA_CENTAURI, PROXIMA];
const STAR_POSITIONS = new Float32Array(STARS.flatMap((star) => [star.x, star.y, star.z]));

const DEEP_SKY_OBJECT: DeepSkyRecord = {
  id: 'NGC0224',
  name: 'Andromeda Galaxy',
  kind: 'galaxy',
  x: 0,
  y: 0,
  z: 1,
  angularSizeDeg: 2.96,
  magnitude: 3.44,
  distancePc: null,
  distanceMethod: null,
  constellation: 'And',
  messier: 'M31'
};

const EARTH: BodyRecord = {
  id: 'earth',
  systemStarId: SUN.id,
  name: 'Earth',
  kind: 'planet',
  radiusKm: 6371,
  orbit: {
    semiMajorAxisAu: 1,
    eccentricity: 0.0167,
    inclinationDeg: 0,
    longitudeOfAscendingNodeDeg: 0,
    argumentOfPeriapsisDeg: 0,
    meanAnomalyAtEpochDeg: 0,
    epochJd: 2451545.0
  }
};

/** Minimal stand-in for `EngineService` that skips real WebGPU/WebGL initialization entirely,
 *  while exposing the same tick-registration hook so tests can drive the render loop by hand. */
class FakeEngineService {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private readonly tickCallbacks = new Set<EngineTickCallback>();
  projection: 'perspective' | 'orthographic' = 'perspective';

  get isInitialized(): boolean {
    return true;
  }

  async init(): Promise<void> {
    // no-op: no real renderer/context is created in tests.
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.projection === 'orthographic' ? this.orthographic : this.camera;
  }

  getPerspectiveCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  get currentProjection(): 'perspective' | 'orthographic' {
    return this.projection;
  }

  setProjection(projection: 'perspective' | 'orthographic', distanceToTarget: number): void {
    this.projection = projection;
    const halfHeight = Math.max(distanceToTarget, 1e-6) * Math.tan((this.camera.fov * Math.PI) / 360);
    this.orthographic.top = halfHeight;
    this.orthographic.bottom = -halfHeight;
    this.orthographic.left = -halfHeight * this.camera.aspect;
    this.orthographic.right = halfHeight * this.camera.aspect;
    this.orthographic.zoom = 1;
    this.orthographic.position.copy(this.camera.position);
    this.orthographic.quaternion.copy(this.camera.quaternion);
    this.orthographic.updateProjectionMatrix();
  }

  visibleHalfHeight(distanceToTarget: number): number {
    return this.projection === 'orthographic'
      ? (this.orthographic.top - this.orthographic.bottom) / (2 * this.orthographic.zoom)
      : distanceToTarget * Math.tan((this.camera.fov * Math.PI) / 360);
  }

  onTick(callback: EngineTickCallback): () => void {
    this.tickCallbacks.add(callback);
    return () => this.tickCallbacks.delete(callback);
  }

  start(): void {}

  stop(): void {}

  dispose(): void {}

  resize(): void {}

  /** Test helper: simulates one rendered frame by invoking every registered tick callback. */
  tick(deltaSeconds: number): void {
    for (const callback of this.tickCallbacks) {
      callback(deltaSeconds, 0);
    }
  }
}

class FakeDataLoaderService {
  loadStars(): Promise<StarField> {
    return Promise.resolve({ stars: STARS, positions: STAR_POSITIONS });
  }

  loadBodies(): Promise<BodyRecord[]> {
    return Promise.resolve([EARTH]);
  }

  loadExoplanets(): Promise<ExoplanetRecord[]> {
    return Promise.resolve([]);
  }

  loadDeepSky(): Promise<DeepSkyRecord[]> {
    return Promise.resolve([DEEP_SKY_OBJECT]);
  }
}

/** Waits out several macrotask turns so chained promises (bootstrap's awaits) settle. */
async function flushAsync(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Advances the fake render loop (and therefore any in-flight `CameraRigController` tween)
 *  by repeatedly ticking a small fixed step, flushing microtasks between frames so any
 *  `onComplete` callback's own side effects (e.g. starting the next leg of the flight) run. */
async function advanceFrames(engine: FakeEngineService, totalSeconds: number, stepSeconds = 0.05): Promise<void> {
  let elapsed = 0;
  while (elapsed < totalSeconds) {
    engine.tick(stepSeconds);
    elapsed += stepSeconds;
    await flushAsync(1);
  }
}

describe('GalaxySystemSceneComponent camera-flight transitions', () => {
  let fixture: ComponentFixture<GalaxySystemSceneComponent>;
  let engine: FakeEngineService;
  let navigationStore: NavigationStore;

  beforeEach(async () => {
    engine = new FakeEngineService();

    TestBed.configureTestingModule({
      imports: [GalaxySystemSceneComponent],
      providers: [
        { provide: DataLoaderService, useClass: FakeDataLoaderService },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } }
      ]
    }).overrideComponent(GalaxySystemSceneComponent, {
      set: { providers: [{ provide: EngineService, useValue: engine }] }
    });

    navigationStore = TestBed.inject(NavigationStore);
    fixture = TestBed.createComponent(GalaxySystemSceneComponent);
    fixture.detectChanges(); // triggers ngAfterViewInit -> bootstrap()
    await flushAsync();
  });

  it('starts in the galaxy view with the system group hidden', () => {
    const component = fixture.componentInstance as unknown as { galaxyGroup: THREE.Group; systemGroup: THREE.Group };
    expect(component.galaxyGroup.visible).toBe(true);
    expect(component.systemGroup.visible).toBe(false);
    expect(navigationStore.viewLevel()).toBe('galaxy');
  });

  it('clears a selection the catalogue no longer holds instead of chasing it', async () => {
    // A bookmark saved against a Gaia row id that the next refresh renumbered. Before the guard,
    // entering the missing system completed at once, completion re-read the same id, and the
    // two recursed until the stack overflowed.
    navigationStore.selectStar(987654321);
    await flushAsync();

    expect(navigationStore.selectedStarId()).toBeNull();
    expect(navigationStore.viewLevel()).toBe('galaxy');
  });

  it('flies the camera into a selected star system: hides the galaxy group, shows the system group, and switches to AU-scale near/far planes', async () => {
    navigationStore.selectStar(SUN.id);
    await flushAsync();

    // Approach leg (parsec space) + settle leg (AU space) with margin.
    await advanceFrames(engine, 2.5);

    const component = fixture.componentInstance as unknown as { galaxyGroup: THREE.Group; systemGroup: THREE.Group };
    expect(component.galaxyGroup.visible).toBe(false);
    expect(component.systemGroup.visible).toBe(true);
    expect(engine.getCamera().near).toBeCloseTo(0.002, 9);
    expect(navigationStore.viewLevel()).toBe('system');
  });

  it('performs the floating-origin recenter: the camera lands close to the AU-space origin, not out at parsec-scale coordinates', async () => {
    navigationStore.selectStar(ALPHA_CENTAURI.id);
    await flushAsync();
    await advanceFrames(engine, 2.5);

    // Regardless of how far away (in parsecs) the star was, once we're in system space the
    // camera must be within a few thousand AU of the origin -- never still out at the star's
    // original parsec-scale distance from the Sun.
    const distanceFromOrigin = engine.getCamera().position.length();
    expect(distanceFromOrigin).toBeLessThan(1000);
    expect(distanceFromOrigin).toBeGreaterThan(0);
  });

  it('flies back out to the galaxy overview and restores parsec-scale near/far planes when the selection is cleared', async () => {
    navigationStore.selectStar(SUN.id);
    await flushAsync();
    await advanceFrames(engine, 2.5);
    expect(navigationStore.viewLevel()).toBe('system');

    navigationStore.selectStar(null);
    await flushAsync();
    await advanceFrames(engine, 2.5);

    const component = fixture.componentInstance as unknown as { galaxyGroup: THREE.Group; systemGroup: THREE.Group };
    expect(component.galaxyGroup.visible).toBe(true);
    expect(component.systemGroup.visible).toBe(false);
    // Parsec-scale rather than an exact figure: in galaxy space the depth range scales with how
    // far the camera has pulled back, so what identifies it is the far plane it settles on
    // (5000 pc) versus the AU-space one (20000 AU), not a fixed near plane.
    expect(engine.getCamera().far).toBeCloseTo(5000, 6);
    // The near plane tracks how far back the camera is rather than sitting at a constant, so
    // what identifies galaxy space is that it is a small fraction of that far plane.
    expect(engine.getCamera().near).toBeLessThan(engine.getCamera().far / 1000);
    expect(navigationStore.viewLevel()).toBe('galaxy');
  });

  it('hopping directly from one system to another exits the first system before entering the second, without settling back in the galaxy view', async () => {
    navigationStore.selectStar(SUN.id);
    await flushAsync();
    await advanceFrames(engine, 2.5);
    expect(navigationStore.viewLevel()).toBe('system');

    navigationStore.selectStar(ALPHA_CENTAURI.id);
    await flushAsync();
    await advanceFrames(engine, 3.5);

    const component = fixture.componentInstance as unknown as { currentStarId: number | null };
    expect(navigationStore.viewLevel()).toBe('system');
    expect(component.currentStarId).toBe(ALPHA_CENTAURI.id);
  });

  it('reports the galactic scale once the camera has pulled back far enough, and comes back', async () => {
    const camera = engine.getCamera();

    camera.position.set(0, 0, 30000);
    await advanceFrames(engine, 0.3);
    expect(navigationStore.viewLevel()).toBe('galactic');

    camera.position.set(0, 15, 30);
    await advanceFrames(engine, 0.3);
    expect(navigationStore.viewLevel()).toBe('galaxy');
  });

  it('widens the depth range as the camera pulls back, instead of holding one range for both scales', async () => {
    const camera = engine.getCamera();

    await advanceFrames(engine, 0.3);
    const localFar = camera.far;

    camera.position.set(0, 0, 30000);
    await advanceFrames(engine, 0.3);

    expect(camera.far).toBeGreaterThan(localFar);
    // A near plane a hundredth of a parsec out has no precision left to spare at this range.
    expect(camera.near).toBeGreaterThan(1);
  });

  it('flies out to the Galaxy when the scale ladder asks for it', async () => {
    const camera = engine.getCamera();
    fixture.componentInstance.goToLevel('galactic');
    await advanceFrames(engine, 3);

    expect(camera.position.length()).toBeGreaterThan(10000);
    expect(navigationStore.viewLevel()).toBe('galactic');
  });

  it('leaves the system first when the scale ladder is used from inside one', async () => {
    navigationStore.selectStar(SUN.id);
    await flushAsync();
    await advanceFrames(engine, 2.5);
    expect(navigationStore.viewLevel()).toBe('system');

    fixture.componentInstance.goToLevel('galactic');
    await flushAsync();
    // Exit leg, then the return leg, then the galactic flight: the request has to wait out the
    // unit-space unwind rather than firing a parsec-scale flight while the scene is in AU.
    await advanceFrames(engine, 6);

    const component = fixture.componentInstance as unknown as { currentStarId: number | null; systemGroup: THREE.Group };
    expect(component.currentStarId).toBeNull();
    expect(component.systemGroup.visible).toBe(false);
    expect(navigationStore.viewLevel()).toBe('galactic');
  });

  it('ignores a new selection while a transition is already in flight, then resolves to the latest requested star once idle', async () => {
    navigationStore.selectStar(SUN.id);
    await flushAsync();

    // Fire a second selection mid-flight, before the first transition has settled.
    await advanceFrames(engine, 0.3);
    navigationStore.selectStar(PROXIMA.id);
    await flushAsync();

    await advanceFrames(engine, 6);

    const component = fixture.componentInstance as unknown as { currentStarId: number | null };
    expect(component.currentStarId).toBe(PROXIMA.id);
    expect(navigationStore.viewLevel()).toBe('system');
  });
});
