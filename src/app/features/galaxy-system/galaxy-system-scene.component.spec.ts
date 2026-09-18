import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { DataLoaderService, StarField } from '../../core/data/data-loader.service';
import { EngineService, EngineTickCallback } from '../../core/engine/engine.service';
import { BodyRecord } from '../../shared/models/body.model';
import { DeepSkyRecord } from '../../shared/models/deepsky.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { NavigationStore } from '../../shared/state/navigation.store';
import { LinkBudget } from '../../shared/astro/jump-links';
import { HudDisplay } from '../hud/hud-dock.component';
import { GalaxySystemSceneComponent } from './galaxy-system-scene.component';
import { galacticNormal } from './grid-plane';
import { JumpLinkRenderer } from './jump-link-renderer';
import { StarFieldRenderer } from './star-field-renderer';
import { LabeledPoint, StarLabelOverlay } from './star-label-overlay';

// jsdom does not implement ResizeObserver; the component only uses it to react to real
// layout changes, which never happen in this headless test.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const SUN: StarRecord = { id: 0, name: 'Sol', x: 0, y: 0, z: 0, magnitude: -26.7, spectralType: 'G2V', colorIndex: 0.656 };
const ALPHA_CENTAURI: StarRecord = { id: 1, name: 'Alpha Centauri', x: 1.34, y: 0, z: 0, magnitude: 4.4, spectralType: 'G2V', colorIndex: 0.7 };
// Its id deliberately differs from its place in STARS, so a lookup by id cannot pass for one by index.
const PROXIMA: StarRecord = { id: 42, name: 'Proxima Centauri', x: 0, y: 1.3, z: 0, magnitude: 11.1, spectralType: 'M5V', colorIndex: 1.8 };

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
    this.orthographic.zoom = 1;
    this.orthographic.position.copy(this.camera.position);
    this.orthographic.quaternion.copy(this.camera.quaternion);
    this.frameOrthographic(distanceToTarget);
  }

  frameOrthographic(distanceToTarget: number): void {
    const halfHeight = Math.max(distanceToTarget, 1e-6) * Math.tan((this.camera.fov * Math.PI) / 360);
    this.orthographic.top = halfHeight;
    this.orthographic.bottom = -halfHeight;
    this.orthographic.left = -halfHeight * this.camera.aspect;
    this.orthographic.right = halfHeight * this.camera.aspect;
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

  /** The canvas's device pixels per CSS pixel, as the renderer was told. */
  pixelRatio = 1;

  getRenderer(): { getPixelRatio(): number } {
    return { getPixelRatio: () => this.pixelRatio };
  }

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

  it('chooses the drawn stars again once the view centre has moved, and not for a small drift', async () => {
    const component = fixture.componentInstance as unknown as { controls: { target: THREE.Vector3 } };
    const refocus = vi.spyOn(StarFieldRenderer.prototype, 'refocus');
    // The first pass always chooses; what is under test is the move after it.
    await advanceFrames(engine, 0.3);
    refocus.mockClear();

    component.controls.target.set(40, 0, 0);
    await advanceFrames(engine, 0.3);
    expect(refocus).toHaveBeenCalledTimes(1);
    expect(refocus.mock.calls[0][0].centre).toMatchObject({ x: 40, y: 0, z: 0 });

    component.controls.target.set(42, 0, 0);
    await advanceFrames(engine, 0.3);
    expect(refocus).toHaveBeenCalledTimes(1);
    refocus.mockRestore();
  });

  describe('the drawn stars, chosen for what the camera shows', () => {
    type ViewScene = { controls: { target: THREE.Vector3; update(): void }; display: { update(change: (display: HudDisplay) => HudDisplay): void } };
    let refocus: MockInstance<StarFieldRenderer['refocus']>;

    beforeEach(() => {
      refocus = vi.spyOn(StarFieldRenderer.prototype, 'refocus');
    });
    afterEach(() => refocus.mockRestore());

    /** Swings the camera about the view's centre, around the scene's vertical, by `degrees`. */
    function orbit(component: ViewScene, degrees: number): void {
      const camera = engine.getCamera();
      const target = component.controls.target;
      camera.position.sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(degrees)).add(target);
      component.controls.update();
    }

    it('chooses them for the opening view on the first pass, planet hosts included', async () => {
      await advanceFrames(engine, 0.6);

      expect(refocus).toHaveBeenCalledTimes(1);
      const [focus] = refocus.mock.calls[0];
      expect(focus.view).toBeDefined();
      // The Sun has Earth, so it is a host; the others have nothing catalogued.
      expect(Array.from(focus.hosts ?? [])).toEqual([1, 0, 0]);
    });

    it('chooses again once the camera has turned half the margin, and not for less', async () => {
      const component = fixture.componentInstance as unknown as ViewScene;
      await advanceFrames(engine, 0.3);

      orbit(component, 1);
      await advanceFrames(engine, 0.3);
      expect(refocus).toHaveBeenCalledTimes(1);

      orbit(component, 3);
      await advanceFrames(engine, 0.3);
      expect(refocus).toHaveBeenCalledTimes(2);
    });

    it('chooses again once a pan has moved the view further than a fifth of the neighbourhood, and not for less', async () => {
      const component = fixture.componentInstance as unknown as ViewScene;
      const camera = engine.getCamera();
      // Camera and centre together, so the camera neither turns nor zooms.
      const pan = (pc: number) => {
        component.controls.target.x += pc;
        camera.position.x += pc;
        component.controls.update();
      };
      await advanceFrames(engine, 0.3);

      pan(3);
      await advanceFrames(engine, 0.3);
      expect(refocus).toHaveBeenCalledTimes(1);

      pan(3);
      await advanceFrames(engine, 0.3);
      expect(refocus).toHaveBeenCalledTimes(2);
    });

    it('chooses again once a zoom has changed the frame by half the margin, and not for less', async () => {
      const component = fixture.componentInstance as unknown as ViewScene;
      const camera = engine.getCamera();
      const dolly = (factor: number) => camera.position.sub(component.controls.target).multiplyScalar(factor).add(component.controls.target);
      await advanceFrames(engine, 0.3);

      dolly(0.95);
      await advanceFrames(engine, 0.3);
      expect(refocus).toHaveBeenCalledTimes(1);

      dolly(0.8);
      await advanceFrames(engine, 0.3);
      expect(refocus).toHaveBeenCalledTimes(2);
    });

    it('chooses again for the plan view, where a small turn moves deep stars furthest', async () => {
      const component = fixture.componentInstance as unknown as ViewScene;
      // About 10 pc of frame either side of the centre.
      engine.getCamera().position.setLength(21.4);
      component.controls.update();
      await advanceFrames(engine, 0.3);
      const beforePlan = refocus.mock.calls.length;

      component.display.update((display) => ({ ...display, plan: true }));
      TestBed.tick();
      await advanceFrames(engine, 0.3);
      expect(refocus).toHaveBeenCalledTimes(beforePlan + 1);

      // Harmless under perspective; under the plan it moves a star 250 pc deep by 4 pc, against a 2.5 pc margin.
      orbit(component, 1);
      await advanceFrames(engine, 0.3);
      expect(refocus).toHaveBeenCalledTimes(beforePlan + 2);
    });

    it('chooses again when the projection changes under a pose that has not moved at all', async () => {
      await advanceFrames(engine, 0.3);
      const before = refocus.mock.calls.length;
      // The same place, direction and frame height, but a box instead of a frustum, which frames other stars.
      const perspective = engine.getPerspectiveCamera();
      const plan = (engine as unknown as { orthographic: THREE.OrthographicCamera }).orthographic;
      plan.position.copy(perspective.position);
      plan.quaternion.copy(perspective.quaternion);
      engine.projection = 'orthographic';

      await advanceFrames(engine, 0.3);

      expect(refocus).toHaveBeenCalledTimes(before + 1);
    });

    it('holds a turn to the narrower side of a portrait frame', async () => {
      const component = fixture.componentInstance as unknown as ViewScene;
      engine.getPerspectiveCamera().aspect = 0.4;
      engine.getPerspectiveCamera().updateProjectionMatrix();
      await advanceFrames(engine, 0.3);

      // Inside half the margin above and below, past half of it at the sides.
      orbit(component, 2);
      await advanceFrames(engine, 0.3);

      expect(refocus).toHaveBeenCalledTimes(2);
    });

    it('keeps up with a flight frame by frame, from the frame it comes back into parsec space', async () => {
      const component = fixture.componentInstance as unknown as ViewScene & { galaxyGroup: THREE.Group; rig: { isAnimating: boolean } };
      navigationStore.selectStar(SUN.id);
      await flushAsync();
      await advanceFrames(engine, 2.5);
      refocus.mockClear();

      navigationStore.selectStar(null);
      await flushAsync();
      let choicesOnReturningFrame = -1;
      let flightFrames = 0;
      let flightChoices = 0;
      for (let frame = 0; frame < 80; frame++) {
        const wasInSystem = !component.galaxyGroup.visible;
        const before = refocus.mock.calls.length;
        engine.tick(0.05);
        await flushAsync(1);
        if (wasInSystem && component.galaxyGroup.visible) {
          choicesOnReturningFrame = refocus.mock.calls.length - before;
        }
        if (component.galaxyGroup.visible && component.rig.isAnimating) {
          flightFrames++;
          flightChoices += refocus.mock.calls.length - before;
        }
      }

      // Chosen for the view in the very frame the camera jumps back, not up to a pass later.
      expect(choicesOnReturningFrame).toBe(1);
      // The return zooms out from inside the system to the opening view: more re-choices than one a
      // pass could make, and every one of them for the view.
      expect(flightChoices).toBeGreaterThan(Math.ceil((flightFrames * 0.05) / 0.2));
      expect(refocus.mock.calls.every(([focus]) => focus.view !== undefined)).toBe(true);
    });

    it('chooses once for the whole sky on the way out to the Galaxy, then leaves them alone', async () => {
      const component = fixture.componentInstance as unknown as ViewScene;
      engine.getCamera().position.set(0, 0, 30000);
      await advanceFrames(engine, 0.3);
      const onArrival = refocus.mock.calls.length;
      expect(refocus.mock.calls.at(-1)![0].view).toBeUndefined();

      component.controls.target.set(500, 0, 0);
      await advanceFrames(engine, 0.3);
      component.controls.target.set(1500, 0, 0);
      await advanceFrames(engine, 0.3);

      expect(refocus).toHaveBeenCalledTimes(onArrival);
      expect(refocus.mock.calls.filter(([focus]) => focus.view === undefined)).toHaveLength(1);
    });
  });

  describe('the local grid of distance rings', () => {
    type GridScene = {
      controls: { target: THREE.Vector3; update(): void };
      display: { update(change: (display: HudDisplay) => HudDisplay): void };
      localGridRadii: readonly number[];
    };

    it('sizes the rings by how far the frame reaches from the Sun, under either projection', async () => {
      const component = fixture.componentInstance as unknown as GridScene;
      const camera = engine.getCamera();
      // Centred on a point 200 pc out along the galactic plane — where the rings are — seen from
      // 20 pc above it. The rings have to reach it, and one of them has to cross the frame.
      const normal = galacticNormal();
      const centre = new THREE.Vector3(1, 0, 0).projectOnPlane(normal).normalize().multiplyScalar(200);
      component.controls.target.copy(centre);
      camera.position.copy(centre).addScaledVector(normal, 20);
      component.controls.update();
      await advanceFrames(engine, 0.3);
      const underPerspective = [...component.localGridRadii];

      component.display.update((display) => ({ ...display, plan: true }));
      TestBed.tick();
      await advanceFrames(engine, 0.3);

      expect(underPerspective.at(-1)).toBeGreaterThanOrEqual(200);
      // The frame is a band about 19 pc either side of 200 pc: rings out to 220 at a step sized to
      // all 220 are 180 and 200, both of them off screen.
      const halfHeight = engine.visibleHalfHeight(20);
      expect(underPerspective.some((radius) => Math.abs(radius - 200) < halfHeight)).toBe(true);
      // The plan view's wheel moves the frame rather than the camera, so "how far out the camera
      // is" means something else there; what the rings have to cover does not.
      expect([...component.localGridRadii]).toEqual(underPerspective);
    });

    it('measures the span in the plane the rings lie in, not through it', async () => {
      const component = fixture.componentInstance as unknown as GridScene;
      const camera = engine.getCamera();
      // The same 200 pc out along the plane, but lifted 150 pc above it: 250 pc from the Sun as the
      // crow flies, and still 200 pc out among the rings, which is the distance they are drawn at.
      const normal = galacticNormal();
      const centre = new THREE.Vector3(1, 0, 0).projectOnPlane(normal).normalize().multiplyScalar(200).addScaledVector(normal, 150);
      component.controls.target.copy(centre);
      camera.position.copy(centre).addScaledVector(normal, 20);
      component.controls.update();
      await advanceFrames(engine, 0.3);

      const halfHeight = engine.visibleHalfHeight(20);
      expect([...component.localGridRadii].some((radius) => Math.abs(radius - 200) < halfHeight)).toBe(true);
    });

    it('leaves the rings alone while the grid is not drawn', async () => {
      const component = fixture.componentInstance as unknown as GridScene;
      const camera = engine.getCamera();
      await advanceFrames(engine, 0.3);
      component.display.update((display) => ({ ...display, grid: false }));
      TestBed.tick();
      await advanceFrames(engine, 0.3);
      const hidden = [...component.localGridRadii];

      // A zoom this size crosses two round steps, and each crossing rebuilds every ring's vertices.
      camera.position.setLength(camera.position.length() / 8);
      component.controls.update();
      await advanceFrames(engine, 0.3);

      expect([...component.localGridRadii]).toEqual(hidden);
    });

    it('drops a ring label that a star name has taken, or that is off screen, and keeps the ladder otherwise', () => {
      const component = fixture.componentInstance as unknown as {
        ringLabelsInTheClear(candidates: readonly LabeledPoint[], camera: THREE.Camera, stars: readonly LabeledPoint[]): LabeledPoint[];
      };
      const camera = engine.getCamera();
      camera.updateMatrixWorld(true);
      const at = (x: number, y: number) => new THREE.Vector3(x, y, 0.5).unproject(camera);
      // Rungs at a twentieth of the screen: well inside the separation two names would keep, and
      // well outside the clearance a ring label keeps from a name, so neither test is a coin toss.
      const near = at(0.1, 0.1);
      const nextRungUp = at(0.1, 0.18);
      const offScreen = at(1.6, 0.1);
      const ladder: LabeledPoint[] = [
        { id: 'ring-50', name: '50 pc', x: near.x, y: near.y, z: near.z },
        { id: 'ring-100', name: '100 pc', x: nextRungUp.x, y: nextRungUp.y, z: nextRungUp.z },
        { id: 'ring-150', name: '150 pc', x: offScreen.x, y: offScreen.y, z: offScreen.z }
      ];

      // A ladder of rings stays whole, though its rungs are closer than two star names would be.
      expect(component.ringLabelsInTheClear(ladder, camera, []).map((label) => label.id)).toEqual(['ring-50', 'ring-100']);
      // A star's name is worth more than a distance.
      const star: LabeledPoint = { id: 7, name: 'Sirius', x: near.x, y: near.y, z: near.z };
      expect(component.ringLabelsInTheClear(ladder, camera, [star]).map((label) => label.id)).toEqual(['ring-100']);
    });

    it('stays out of the text of a name, not just off its point', () => {
      const component = fixture.componentInstance as unknown as {
        ringLabelsInTheClear(candidates: readonly LabeledPoint[], camera: THREE.Camera, stars: readonly LabeledPoint[]): LabeledPoint[];
        viewportAspect(): number;
      };
      const camera = engine.getCamera();
      camera.updateMatrixWorld(true);
      const aspect = component.viewportAspect();
      const at = (x: number, y: number) => new THREE.Vector3(x / aspect, y, 0.5).unproject(camera);
      // A hand's breadth apart on screen — past any clearance around the point — and on the same
      // line, with the name's text running right through where the ring label starts.
      const ring = at(0.125, -0.123);
      const rung: LabeledPoint = { id: 'ring-50', name: '50 pc', x: ring.x, y: ring.y, z: ring.z };
      const beside = at(0.06, -0.12);
      const rightHand: LabeledPoint = { id: 7, name: 'Alpha Centauri', side: 'right', x: beside.x, y: beside.y, z: beside.z };

      expect(component.ringLabelsInTheClear([rung], camera, [rightHand])).toEqual([]);
      // The same name hanging the other way leaves that space empty, and the rung with it.
      expect(component.ringLabelsInTheClear([rung], camera, [{ ...rightHand, side: 'left' }])).toEqual([rung]);

      // And a rung to the left of a name keeps its place: "50 pc" is a third of a star name's
      // width, so it ends well before the name starts, whatever the anchors' spacing suggests.
      const centred = at(0, 0);
      const spanning: LabeledPoint = { id: 8, name: 'Alnitak', side: 'right', x: centred.x, y: centred.y, z: centred.z };
      const toTheLeft = at(-0.25, 0.02);
      const clearRung: LabeledPoint = { id: 'ring-100', name: '100 pc', x: toTheLeft.x, y: toTheLeft.y, z: toTheLeft.z };

      expect(component.ringLabelsInTheClear([clearRung], camera, [spanning])).toEqual([clearRung]);
    });

    it('places the ring labels with the star names rather than over them', async () => {
      const component = fixture.componentInstance as unknown as GridScene;
      const update = vi.spyOn(StarLabelOverlay.prototype, 'update');
      const cleared = vi.spyOn(GalaxySystemSceneComponent.prototype as unknown as { ringLabelsInTheClear: (...args: unknown[]) => LabeledPoint[] }, 'ringLabelsInTheClear');
      const camera = engine.getCamera();
      camera.position.set(0, 4, 10);
      component.controls.target.set(0, 0, 0);
      component.controls.update();
      await advanceFrames(engine, 0.3);

      const labels = (update.mock.calls.at(-1)?.[0] ?? []) as LabeledPoint[];
      const rings = labels.filter((label) => String(label.id).startsWith('ring-'));
      expect(rings.length).toBeGreaterThan(0);
      // Handed over as the clearing pass left them, not as the grid produced them.
      expect(cleared).toHaveBeenCalled();
      expect(rings).toEqual(cleared.mock.results.at(-1)?.value);
      update.mockRestore();
      cleared.mockRestore();
    });
  });

  it('keeps the stars of a plotted route drawn, and the selected star', async () => {
    const component = fixture.componentInstance as unknown as { routeResult: { set(value: unknown): void } };
    const refocus = vi.spyOn(StarFieldRenderer.prototype, 'refocus');
    await advanceFrames(engine, 0.3);

    component.routeResult.set({ stars: [{ id: SUN.id, name: 'Sol' }, { id: PROXIMA.id, name: 'Proxima Centauri' }], totalPc: 1.3, neededRangePc: null });
    await advanceFrames(engine, 0.3);

    // As catalogue indices: the Sun is the first entry of STARS, Proxima the third.
    expect(refocus.mock.calls.at(-1)![0].pinned).toEqual([0, 2]);
    refocus.mockRestore();
  });

  describe('the jump-link graph', () => {
    type LinkScene = {
      routing: { links(rangePc: number, drawn: Uint32Array, budget?: LinkBudget): Promise<Float32Array>; route(): Promise<never>; dispose(): void };
      display: { update(change: (display: { jumpLinks: boolean }) => unknown): void };
      jumpRangePc: { set(rangePc: number): void };
      routeResult: { set(value: unknown): void };
      controls: { target: THREE.Vector3 };
      starField: { drawnStars: Uint32Array; drawn: Uint32Array };
    };
    /** Real time, since the rebuild waits on a real timer for the range and the drawn stars to settle. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

    function linkScene(links: LinkScene['routing']['links']): LinkScene {
      const component = fixture.componentInstance as unknown as LinkScene;
      component.routing = { links, route: () => new Promise<never>(() => undefined), dispose: () => undefined };
      component.display.update((display) => ({ ...display, jumpLinks: true }));
      TestBed.tick();
      return component;
    }

    /** Makes the next refocus choose a different set: the field is told it draws one star, then the view moves. */
    async function changeDrawnStars(component: LinkScene, targetX: number): Promise<void> {
      component.starField.drawn = Uint32Array.of(0);
      component.controls.target.set(targetX, 0, 0);
      await advanceFrames(engine, 0.3);
    }

    it('links the stars being drawn, and asks again once a new set of them holds still', async () => {
      const links = vi.fn((_rangePc: number, _drawn: Uint32Array) => Promise.resolve(new Float32Array(0)));
      const component = linkScene(links);
      await settle();
      expect(links).toHaveBeenCalledTimes(1);
      expect(links.mock.calls[0].slice(0, 2)).toEqual([3, component.starField.drawnStars]);

      await changeDrawnStars(component, 40);
      expect(links).toHaveBeenCalledTimes(1);
      await settle();
      expect(links).toHaveBeenCalledTimes(2);
      expect(links.mock.calls[1][1]).toBe(component.starField.drawnStars);
      expect(links.mock.calls[1][1]).not.toBe(links.mock.calls[0][1]);

      // A route re-chooses the drawn stars around its pins, and here they come out the same: no new graph.
      component.routeResult.set({ stars: [{ id: SUN.id, name: 'Sol' }], totalPc: 0, neededRangePc: null });
      await advanceFrames(engine, 0.3);
      await settle();
      expect(links).toHaveBeenCalledTimes(2);
    });

    it('asks for as much of the graph as a million pixels of line make, around where the view is centred', async () => {
      const links = vi.fn((_rangePc: number, _drawn: Uint32Array, _budget?: LinkBudget) => Promise.resolve(new Float32Array(0)));
      Object.defineProperty((fixture.nativeElement as HTMLElement).querySelector('canvas')!, 'clientHeight', { value: 1080 });
      // A screen scaled to 200%: 1080 CSS pixels are 2160 drawn ones, and the lines are drawn in those.
      engine.pixelRatio = 2;
      linkScene(links);
      await settle();

      const budget = links.mock.calls[0][2];
      // The view opens centred on the Sun: its frame's half-height there, over 1080 drawn pixels, is a pixel's worth of parsecs.
      const halfHeight = engine.getCamera().position.length() * Math.tan((50 * Math.PI) / 360);
      expect(budget?.centre).toEqual({ x: 0, y: 0, z: 0 });
      expect(budget?.lengthPc).toBeCloseTo((1_000_000 * halfHeight) / 1080, 3);
    });

    it('asks again once the view has zoomed past the budget it asked with, though the drawn stars are the same', async () => {
      // All three stars fit the star budget, so the drawn set never changes: only the budget can.
      const links = vi.fn((_rangePc: number, _drawn: Uint32Array, _budget?: LinkBudget) => Promise.resolve(new Float32Array(0)));
      Object.defineProperty((fixture.nativeElement as HTMLElement).querySelector('canvas')!, 'clientHeight', { value: 1080 });
      const component = linkScene(links);
      await advanceFrames(engine, 0.3);
      await settle();
      const asked = links.mock.calls.length;

      const camera = engine.getCamera();
      camera.position.sub(component.controls.target).multiplyScalar(0.5).add(component.controls.target);
      await advanceFrames(engine, 0.3);
      await settle();

      expect(links.mock.calls.length).toBe(asked + 1);
      expect(links.mock.calls.at(-1)![1]).toBe(links.mock.calls[0][1]);
    });

    it('asks for no graph from inside a system, where distances are in astronomical units', async () => {
      const links = vi.fn((_rangePc: number, _drawn: Uint32Array, _budget?: LinkBudget) => Promise.resolve(new Float32Array(0)));
      navigationStore.selectStar(SUN.id);
      await flushAsync();
      await advanceFrames(engine, 2.5);

      linkScene(links);
      await settle();

      expect(links).not.toHaveBeenCalled();
    });

    it('keeps what it asked for when an older request it replaced is rejected', async () => {
      // Off and on again while a graph is still waiting: the waiting one is replaced, and its
      // rejection must not be taken for the request that replaced it.
      const pending: Array<{ resolve: (segments: Float32Array) => void; reject: (error: Error) => void }> = [];
      const setSegments = vi.spyOn(JumpLinkRenderer.prototype, 'setSegments');
      const component = linkScene(() => new Promise<Float32Array>((resolve, reject) => pending.push({ resolve, reject })));
      await settle();
      component.display.update((display) => ({ ...display, jumpLinks: false }));
      TestBed.tick();
      await settle();
      component.display.update((display) => ({ ...display, jumpLinks: true }));
      TestBed.tick();
      await settle();
      expect(pending).toHaveLength(2);

      pending[0].reject(new Error('Superseded by a newer request'));
      await flushAsync();
      const graph = new Float32Array(6);
      pending[1].resolve(graph);
      await flushAsync();

      expect(setSegments).toHaveBeenLastCalledWith(graph);
      setSegments.mockRestore();
    });

    it('gives a view on the move a new graph at least every quarter second, rather than waiting for it to stop', async () => {
      const links = vi.fn((_rangePc: number, _drawn: Uint32Array) => Promise.resolve(new Float32Array(0)));
      const component = linkScene(links);
      await settle();

      // A new drawn set about every 150 ms for a second, as an orbit makes one each pass.
      for (let pass = 1; pass <= 7; pass++) {
        await changeDrawnStars(component, pass * 40);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      expect(links.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('draws a late graph for the range still asked for, and not one for a range left behind', async () => {
      const answers: Array<(segments: Float32Array) => void> = [];
      const setSegments = vi.spyOn(JumpLinkRenderer.prototype, 'setSegments');
      const component = linkScene(() => new Promise<Float32Array>((resolve) => answers.push(resolve)));
      await settle();
      await changeDrawnStars(component, 40);
      await settle();
      expect(answers).toHaveLength(2);

      // For stars no longer drawn, but at the range still asked for: newer than what is on screen.
      const olderSet = new Float32Array(6);
      answers[0](olderSet);
      await flushAsync();
      expect(setSegments).toHaveBeenLastCalledWith(olderSet);

      component.jumpRangePc.set(5);
      TestBed.tick();
      await settle();
      expect(answers).toHaveLength(3);
      answers[1](new Float32Array(12));
      await flushAsync();
      expect(setSegments).toHaveBeenLastCalledWith(olderSet);

      const current = new Float32Array(18);
      answers[2](current);
      await flushAsync();
      expect(setSegments).toHaveBeenLastCalledWith(current);
      setSegments.mockRestore();
    });
  });

  it('shows the answer to the latest route asked for, whatever order the answers arrive in', async () => {
    type Answer = { route: { stars: number[]; totalPc: number; longestHopPc: number } | null; neededRangePc: number | null };
    const answers: Array<(answer: Answer) => void> = [];
    const component = fixture.componentInstance as unknown as {
      routing: { route(): Promise<Answer>; links(): Promise<Float32Array>; dispose(): void };
      routePending(): boolean;
      routeResult(): { stars: { id: number }[] } | null;
      onRouteRequested(request: { fromId: number; toId: number; rangePc: number }): void;
    };
    component.routing = {
      route: () => new Promise<Answer>((resolve) => answers.push(resolve)),
      links: () => Promise.resolve(new Float32Array(0)),
      dispose: () => undefined
    };

    component.onRouteRequested({ fromId: SUN.id, toId: ALPHA_CENTAURI.id, rangePc: 2 });
    component.onRouteRequested({ fromId: SUN.id, toId: PROXIMA.id, rangePc: 2 });
    expect(component.routePending()).toBe(true);

    answers[1]({ route: { stars: [SUN.id, PROXIMA.id], totalPc: 1.3, longestHopPc: 1.3 }, neededRangePc: null });
    await flushAsync();
    answers[0]({ route: { stars: [SUN.id, ALPHA_CENTAURI.id], totalPc: 1.34, longestHopPc: 1.34 }, neededRangePc: null });
    await flushAsync();

    expect(component.routeResult()?.stars.map((star) => star.id)).toEqual([SUN.id, PROXIMA.id]);
    expect(component.routePending()).toBe(false);
  });

  it('releases the routes panel when a route cannot be worked out, so it can be tried again', async () => {
    const component = fixture.componentInstance as unknown as {
      routing: { route(): Promise<never>; links(): Promise<Float32Array>; dispose(): void };
      routePending(): boolean;
      onRouteRequested(request: { fromId: number; toId: number; rangePc: number }): void;
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    component.routing = { route: () => Promise.reject(new Error('worker gone')), links: () => Promise.resolve(new Float32Array(0)), dispose: () => undefined };

    component.onRouteRequested({ fromId: SUN.id, toId: PROXIMA.id, rangePc: 2 });
    await flushAsync();

    expect(component.routePending()).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('asks for no more label candidates once the last label it will show is placed', () => {
    // Near the Sun a label candidate past the fifteenth can sit at the far end of the catalogue's
    // brightness order, so asking for one more than is used can cost a walk of the whole order.
    const component = fixture.componentInstance as unknown as {
      spreadLabels(candidates: Iterable<{ id: number; name: string; x: number; y: number; z: number }>, camera: THREE.Camera, keepId: null): unknown[];
    };
    const camera = engine.getCamera();
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let pulled = 0;
    const grid = function* () {
      for (let row = 0; row < 5; row++) {
        for (let column = 0; column < 5; column++) {
          pulled++;
          const point = new THREE.Vector3(-0.8 + column * 0.4, -0.8 + row * 0.4, 0.5).unproject(camera);
          yield { id: row * 5 + column, name: `label-${pulled}`, x: point.x, y: point.y, z: point.z };
        }
      }
    };

    expect(component.spreadLabels(grid(), camera, null)).toHaveLength(15);
    expect(pulled).toBe(15);
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
