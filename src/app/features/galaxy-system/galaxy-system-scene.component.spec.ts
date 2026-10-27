import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { Navigation, provideRouter, Router } from '@angular/router';
import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { DataLoaderService, StarField } from '../../core/data/data-loader.service';
import { EngineService, EngineTickCallback } from '../../core/engine/engine.service';
import { BodyRecord } from '../../shared/models/body.model';
import { GM_SUN_AU3_PER_DAY2 } from '../../shared/astro/constants';
import { keplerRates } from '../../shared/astro/kepler';
import { DeepSkyRecord } from '../../shared/models/deepsky.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { NavigationStore } from '../../shared/state/navigation.store';
import { TimeStore } from '../../shared/state/time.store';
import { LinkBudget } from '../../shared/astro/jump-links';
import { HudDisplay, HudDockComponent } from '../hud/hud-dock.component';
import { GalaxySystemSceneComponent } from './galaxy-system-scene.component';
import { SearchIndexService } from '../search/search-index.service';
import { normalView, positionViewDirection } from 'three/tsl';
import { galacticNormal } from './grid-plane';
import { catalogueCensus, deepSkyReadouts, positionsNote } from './star-readouts';
import { closestApproachAu, SUN_RADIUS_AU, systemFramingDistanceAu } from './system-framing';
import { blackbodyColor, SOLAR_EFFECTIVE_TEMPERATURE_K } from '../../shared/astro/stellar';
import { appearanceForExoplanet } from '../../shared/astro/body-appearance';
import { planetTexture } from '../../shared/rendering/procedural-planet-texture';
import { loadCachedTexture, SUN_TEXTURE_PATH } from '../../shared/rendering/texture-catalog';
import { DeepSkyRenderer } from './deep-sky-renderer';
import { JumpLinkRenderer } from './jump-link-renderer';
import { StarFieldRenderer } from './star-field-renderer';
import { SystemOrbitsRenderer } from './system-orbits-renderer';
import { LabeledPoint, StarLabelOverlay } from './star-label-overlay';

// jsdom does not implement ResizeObserver; the component only uses it to react to real
// layout changes, which never happen in this headless test.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const SUN: StarRecord = {
  id: 0,
  name: 'Sol',
  x: 0,
  y: 0,
  z: 0,
  magnitude: -26.7,
  spectralType: 'G2V',
  colorIndex: 0.656,
};
const ALPHA_CENTAURI: StarRecord = {
  id: 1,
  name: 'Alpha Centauri',
  x: 1.34,
  y: 0,
  z: 0,
  magnitude: 4.4,
  spectralType: 'G2V',
  colorIndex: 0.7,
};
// Its id deliberately differs from its place in STARS, so a lookup by id cannot pass for one by index.
const PROXIMA: StarRecord = {
  id: 42,
  name: 'Proxima Centauri',
  x: 0,
  y: 1.3,
  z: 0,
  magnitude: 11.1,
  spectralType: 'M5V',
  colorIndex: 1.8,
};

// A supergiant nothing publishes a radius for, and a white dwarf with neither a colour nor a type
// the parser reads, for what the system view draws each star at; last, so the indices above hold.
const ANTARES: StarRecord = {
  id: 80519,
  name: 'Antares',
  x: -58.54,
  y: -140.31,
  z: -75.57,
  magnitude: 1.06,
  magnitudeBand: 'V',
  spectralType: 'M1Ib + B2.5V',
  colorIndex: 1.865,
  colorSystem: 'B-V',
};
const PROCYON_B: StarRecord = {
  id: 37279,
  name: 'Gl 280B',
  x: -1.08,
  y: 3.19,
  z: 0.34,
  magnitude: 10.7,
  magnitudeBand: 'V',
  spectralType: 'DA',
  colorIndex: null,
};

// A host only the archive places, at the stand-in magnitude, with no type and no colour.
const LENS: StarRecord = {
  id: 1070000536,
  name: 'KMT-2016-BLG-1107L',
  x: 6651,
  y: 0,
  z: 0,
  magnitude: 15,
  spectralType: 'Unknown',
  colorIndex: null,
  source: 'exoplanet-archive',
};

const STARS: StarRecord[] = [SUN, ALPHA_CENTAURI, PROXIMA, ANTARES, PROCYON_B, LENS];
const STAR_POSITIONS = new Float32Array(STARS.flatMap((star) => [star.x, star.y, star.z]));

// Proxima's planet as the archive gives it, with its host's radius, temperature and luminosity.
const PROXIMA_B: ExoplanetRecord = {
  id: 'Proxima Cen b',
  hostStarId: PROXIMA.id,
  hostStarName: 'Proxima Cen',
  name: 'Proxima Cen b',
  hostStarRadiusSolar: 0.141,
  hostStarTemperatureK: 2900,
  hostStarLuminositySolar: 0.00151,
  orbit: { semiMajorAxisAu: 0.0485, eccentricity: 0.02 },
};

// A microlensing planet, whose host the archive places 6.7 kpc out.
const LENS_B: ExoplanetRecord = {
  id: 'KMT-2016-BLG-1107L b',
  hostStarId: LENS.id,
  hostStarName: 'KMT-2016-BLG-1107L',
  name: 'KMT-2016-BLG-1107L b',
  orbit: {},
};

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
  messier: 'M31',
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
    epochJd: 2451545.0,
  },
  rates: keplerRates(1, GM_SUN_AU3_PER_DAY2),
  orbitSource: 'test',
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
    const halfHeight =
      Math.max(distanceToTarget, 1e-6) * Math.tan((this.camera.fov * Math.PI) / 360);
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
    return Promise.resolve([PROXIMA_B, LENS_B]);
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
async function advanceFrames(
  engine: FakeEngineService,
  totalSeconds: number,
  stepSeconds = 0.05,
): Promise<void> {
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
        // A real router over a mocked location, so the URL the scene writes can be read back and Back pressed.
        provideRouter([]),
        provideLocationMocks(),
      ],
    }).overrideComponent(GalaxySystemSceneComponent, {
      set: { providers: [{ provide: EngineService, useValue: engine }] },
    });

    navigationStore = TestBed.inject(NavigationStore);
    fixture = TestBed.createComponent(GalaxySystemSceneComponent);
    fixture.detectChanges(); // triggers ngAfterViewInit -> bootstrap()
    await flushAsync();
  });

  it('rings the systems inside the survey edge, and puts them first in the draw budget, not a host kiloparsecs out', () => {
    const scene = fixture.componentInstance as unknown as {
      hostRings: { count: number };
      hostStars: Uint8Array;
    };
    expect(scene.hostRings.count).toBe(2);
    expect([...scene.hostStars]).toEqual(
      STARS.map((star) => (star === SUN || star === PROXIMA ? 1 : 0)),
    );
  });

  it('starts in the galaxy view with the system group hidden', () => {
    const component = fixture.componentInstance as unknown as {
      galaxyGroup: THREE.Group;
      systemGroup: THREE.Group;
    };
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

  describe('the address bar', () => {
    let location: SpyLocation;

    beforeEach(() => {
      location = TestBed.inject(Location) as SpyLocation;
      // What the app's bootstrap does and TestBed does not: it is what subscribes the router to popstate.
      TestBed.inject(Router).initialNavigation();
    });

    /** Puts a fresh map on the URL given, as a link, a reload or the body page's back control would. */
    async function mountAt(url: string): Promise<void> {
      fixture.destroy();
      await TestBed.inject(Router).navigateByUrl(url);
      fixture = TestBed.createComponent(GalaxySystemSceneComponent);
      fixture.detectChanges();
      await flushAsync();
      // Long enough for a star-to-star hop: out of one system, then into the next.
      await advanceFrames(engine, 5, 0.1);
    }

    async function choose(starId: number | null): Promise<void> {
      navigationStore.selectStar(starId);
      TestBed.tick();
      await flushAsync();
      // Long enough for a star-to-star hop: out of one system, then into the next.
      await advanceFrames(engine, 5, 0.1);
    }

    async function back(): Promise<void> {
      location.back();
      await flushAsync();
      // Long enough for a star-to-star hop: out of one system, then into the next.
      await advanceFrames(engine, 5, 0.1);
    }

    it('names each system entered in ?star=, keeping the other parameters, and Back retraces them to the neighbourhood', async () => {
      await mountAt('/?stars=4000');
      const opened = location.urlChanges.length;
      await choose(SUN.id);
      await choose(PROXIMA.id);
      // Pushed, not replaced: one history entry per system.
      expect(location.urlChanges.slice(opened)).toEqual([
        '/?stars=4000&star=0',
        '/?stars=4000&star=42',
      ]);

      await back();
      expect(navigationStore.selectedStarId()).toBe(SUN.id);
      expect(navigationStore.viewLevel()).toBe('system');
      await back();
      expect(navigationStore.selectedStarId()).toBeNull();
      expect(navigationStore.viewLevel()).toBe('galaxy');
      expect(location.path()).toBe('/?stars=4000');
      // Four flights of five frames each: 4.3-4.8 s on an idle machine, and past Vitest's 5 s
      // default (5.2 s) on a loaded one.
    }, 15_000);

    it('opens in the system a link names', async () => {
      await mountAt('/?star=42');
      expect(navigationStore.selectedStarId()).toBe(PROXIMA.id);
      expect(navigationStore.viewLevel()).toBe('system');
      expect(location.path()).toBe('/?star=42');
    });

    it('opens on the neighbourhood for an id the catalogue lacks, replacing the entry so Back does not return to it', async () => {
      await mountAt('/?star=987654321');
      expect(navigationStore.selectedStarId()).toBeNull();
      expect(navigationStore.viewLevel()).toBe('galaxy');
      expect(location.urlChanges.at(-1)).toBe('replace: /');
    });

    it('reads anything but digits as no star at all, not as the Sun', async () => {
      await mountAt('/?star=');
      expect(navigationStore.selectedStarId()).toBeNull();
      expect(navigationStore.viewLevel()).toBe('galaxy');
    });

    it('opens on the neighbourhood when Back returns to an entry naming no star, whatever a body page chose', async () => {
      // The body page chose its host star; Back then builds the map under the router's popstate
      // navigation, still under way while the map is constructed.
      navigationStore.selectStar(SUN.id);
      const router = TestBed.inject(Router);
      vi.spyOn(router, 'currentNavigation').mockReturnValue({ trigger: 'popstate' } as Navigation);
      const before = location.urlChanges.length;
      await mountAt('/?stars=4000');
      expect(navigationStore.selectedStarId()).toBeNull();
      expect(navigationStore.viewLevel()).toBe('galaxy');
      // The entry is left as it was, not rewritten to the host star's system.
      expect(location.path()).toBe('/?stars=4000');
      expect(location.urlChanges.slice(before)).toEqual(['/?stars=4000']);
    });

    it('carries a star chosen before the map mounted, from a body page, onto the URL without a second entry', async () => {
      navigationStore.selectStar(SUN.id);
      await mountAt('/');
      expect(navigationStore.viewLevel()).toBe('system');
      expect(location.urlChanges.at(-1)).toBe('replace: /?star=0');
    });
  });

  it('chooses the drawn stars again once the view centre has moved, and not for a small drift', async () => {
    const component = fixture.componentInstance as unknown as {
      controls: { target: THREE.Vector3 };
    };
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
    type ViewScene = {
      controls: { target: THREE.Vector3; update(): void };
      display: { update(change: (display: HudDisplay) => HudDisplay): void };
    };
    let refocus: MockInstance<StarFieldRenderer['refocus']>;

    beforeEach(() => {
      refocus = vi.spyOn(StarFieldRenderer.prototype, 'refocus');
    });
    afterEach(() => refocus.mockRestore());

    /** Swings the camera about the view's centre, around the scene's vertical, by `degrees`. */
    function orbit(component: ViewScene, degrees: number): void {
      const camera = engine.getCamera();
      const target = component.controls.target;
      camera.position
        .sub(target)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(degrees))
        .add(target);
      component.controls.update();
    }

    it('chooses them for the opening view on the first pass, planet hosts included', async () => {
      await advanceFrames(engine, 0.6);

      expect(refocus).toHaveBeenCalledTimes(1);
      const [focus] = refocus.mock.calls[0];
      expect(focus.view).toBeDefined();
      // The Sun has Earth and Proxima its b, so both are hosts; the lens has a planet too, but 6.7 kpc
      // out, past the survey edge; the others have nothing catalogued.
      expect(Array.from(focus.hosts ?? [])).toEqual([1, 0, 1, 0, 0, 0]);
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
      const dolly = (factor: number) =>
        camera.position
          .sub(component.controls.target)
          .multiplyScalar(factor)
          .add(component.controls.target);
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
      const component = fixture.componentInstance as unknown as ViewScene & {
        galaxyGroup: THREE.Group;
        rig: { isAnimating: boolean };
      };
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
      const centre = new THREE.Vector3(1, 0, 0)
        .projectOnPlane(normal)
        .normalize()
        .multiplyScalar(200);
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
      const centre = new THREE.Vector3(1, 0, 0)
        .projectOnPlane(normal)
        .normalize()
        .multiplyScalar(200)
        .addScaledVector(normal, 150);
      component.controls.target.copy(centre);
      camera.position.copy(centre).addScaledVector(normal, 20);
      component.controls.update();
      await advanceFrames(engine, 0.3);

      const halfHeight = engine.visibleHalfHeight(20);
      expect(
        [...component.localGridRadii].some((radius) => Math.abs(radius - 200) < halfHeight),
      ).toBe(true);
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
        ringLabelsInTheClear(
          candidates: readonly LabeledPoint[],
          camera: THREE.Camera,
          stars: readonly LabeledPoint[],
        ): LabeledPoint[];
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
        { id: 'ring-150', name: '150 pc', x: offScreen.x, y: offScreen.y, z: offScreen.z },
      ];

      // A ladder of rings stays whole, though its rungs are closer than two star names would be.
      expect(component.ringLabelsInTheClear(ladder, camera, []).map((label) => label.id)).toEqual([
        'ring-50',
        'ring-100',
      ]);
      // A star's name is worth more than a distance.
      const star: LabeledPoint = { id: 7, name: 'Sirius', x: near.x, y: near.y, z: near.z };
      expect(
        component.ringLabelsInTheClear(ladder, camera, [star]).map((label) => label.id),
      ).toEqual(['ring-100']);
    });

    it('stays out of the text of a name, not just off its point', () => {
      const component = fixture.componentInstance as unknown as {
        ringLabelsInTheClear(
          candidates: readonly LabeledPoint[],
          camera: THREE.Camera,
          stars: readonly LabeledPoint[],
        ): LabeledPoint[];
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
      const rightHand: LabeledPoint = {
        id: 7,
        name: 'Alpha Centauri',
        side: 'right',
        x: beside.x,
        y: beside.y,
        z: beside.z,
      };

      expect(component.ringLabelsInTheClear([rung], camera, [rightHand])).toEqual([]);
      // The same name hanging the other way leaves that space empty, and the rung with it.
      expect(
        component.ringLabelsInTheClear([rung], camera, [{ ...rightHand, side: 'left' }]),
      ).toEqual([rung]);
      // But not the point itself: a rung 0.04 right of it, where no text is, still crowds the name.
      const onThePoint = at(0.1, -0.12);
      expect(
        component.ringLabelsInTheClear(
          [{ ...rung, x: onThePoint.x, y: onThePoint.y, z: onThePoint.z }],
          camera,
          [{ ...rightHand, side: 'left' }],
        ),
      ).toEqual([]);

      // And a rung to the left of a name keeps its place: "50 pc" is a third of a star name's
      // width, so it ends well before the name starts, whatever the anchors' spacing suggests.
      const centred = at(0, 0);
      const spanning: LabeledPoint = {
        id: 8,
        name: 'Alnitak',
        side: 'right',
        x: centred.x,
        y: centred.y,
        z: centred.z,
      };
      const toTheLeft = at(-0.25, 0.02);
      const clearRung: LabeledPoint = {
        id: 'ring-100',
        name: '100 pc',
        x: toTheLeft.x,
        y: toTheLeft.y,
        z: toTheLeft.z,
      };

      expect(component.ringLabelsInTheClear([clearRung], camera, [spanning])).toEqual([clearRung]);
    });

    it('drops a rung whose distance would print on the one kept before it, where the ladder foreshortens', () => {
      const component = fixture.componentInstance as unknown as {
        ringLabelsInTheClear(
          candidates: readonly LabeledPoint[],
          camera: THREE.Camera,
          stars: readonly LabeledPoint[],
        ): LabeledPoint[];
        viewportAspect(): number;
      };
      const camera = engine.getCamera();
      camera.updateMatrixWorld(true);
      const aspect = component.viewportAspect();
      // Looking along the ladder's bearing, low over the plane: the rungs step 0.12 across and
      // barely up, closer than the 0.23 a distance's text reaches.
      const ladder = [0, 1, 2, 3, 4, 5].map((step): LabeledPoint => {
        const point = new THREE.Vector3((-0.6 + step * 0.12) / aspect, 0.005 * step, 0.5).unproject(
          camera,
        );
        return { id: `ring-${step}`, name: `${step} pc`, x: point.x, y: point.y, z: point.z };
      });

      expect(component.ringLabelsInTheClear(ladder, camera, []).map((label) => label.id)).toEqual([
        'ring-0',
        'ring-2',
        'ring-4',
      ]);

      // Straight up, 0.04 apart: a distance is one line, so one clears the next; a rung with
      // "Survey edge" under its distance is two, and does not.
      const rung = (id: string, y: number, kind?: string): LabeledPoint => {
        const point = new THREE.Vector3(0, y, 0.5).unproject(camera);
        return { id, name: id, ...(kind ? { kind } : {}), x: point.x, y: point.y, z: point.z };
      };
      expect(
        component
          .ringLabelsInTheClear([rung('a', 0), rung('b', 0.04)], camera, [])
          .map((label) => label.id),
      ).toEqual(['a', 'b']);
      expect(
        component
          .ringLabelsInTheClear([rung('a', 0), rung('b', 0.04, 'Survey edge')], camera, [])
          .map((label) => label.id),
      ).toEqual(['a']);
    });

    it('places the ring labels with the star names rather than over them', async () => {
      const component = fixture.componentInstance as unknown as GridScene;
      const update = vi.spyOn(StarLabelOverlay.prototype, 'update');
      const cleared = vi.spyOn(
        GalaxySystemSceneComponent.prototype as unknown as {
          ringLabelsInTheClear: (...args: unknown[]) => LabeledPoint[];
        },
        'ringLabelsInTheClear',
      );
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

    it('places the survey edge before the star names, as the one rung the Readout cites', async () => {
      const update = vi.spyOn(StarLabelOverlay.prototype, 'update');
      const camera = engine.getCamera();
      camera.updateMatrixWorld(true);
      // Where Sol's name would print: 0.15 right of its point, past the 0.12 two names keep
      // between their points and inside its text.
      const sol = new THREE.Vector3(SUN.x, SUN.y, SUN.z).project(camera);
      const point = (dx: number, dy: number) =>
        new THREE.Vector3(sol.x + dx, sol.y + dy, sol.z).unproject(camera);
      const rung = (radius: number, dy: number, kind?: string): LabeledPoint => {
        const at = point(0.15, dy);
        return {
          id: `ring-${radius}`,
          name: `${radius} pc`,
          ...(kind ? { kind } : {}),
          tone: 'ghost',
          x: at.x,
          y: at.y,
          z: at.z,
        };
      };
      // The rung before it in the ladder prints into it, and a deep-sky name would sit on its point.
      const ladder = vi
        .spyOn(
          GalaxySystemSceneComponent.prototype as unknown as { ringLabels: () => LabeledPoint[] },
          'ringLabels',
        )
        .mockReturnValue([rung(200, -0.02), rung(250, 0, 'Survey edge')]);
      const nebula = point(0.2, 0);
      (fixture.componentInstance as unknown as { deepSkyLabels: LabeledPoint[] }).deepSkyLabels = [
        { id: 'M42', name: 'Orion Nebula', kind: 'Nebula', x: nebula.x, y: nebula.y, z: nebula.z },
      ];
      await advanceFrames(engine, 0.3);

      const labels = (update.mock.calls.at(-1)?.[0] ?? []) as LabeledPoint[];
      expect(labels.map((label) => label.id)).toContain('ring-250');
      expect(labels.map((label) => label.id)).not.toContain('ring-200');
      expect(labels.map((label) => label.id)).not.toContain('M42');
      // The name gives way, to its other side.
      expect(labels.find((label) => label.id === SUN.id)?.side).toBe('left');
      update.mockRestore();
      ladder.mockRestore();
    });

    it('takes no place from a name for a survey edge that would print under the HUD', async () => {
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      Object.defineProperty(canvas, 'clientWidth', { value: 1600 });
      Object.defineProperty(canvas, 'clientHeight', { value: 900 });
      canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1600, 900);
      const aspect = 1600 / 900;
      // A pass first, which puts up the readout.
      await advanceFrames(engine, 0.3);
      fixture.detectChanges();
      const update = vi.spyOn(StarLabelOverlay.prototype, 'update');
      const camera = engine.getCamera();
      camera.updateMatrixWorld(true);
      // The rung 0.15 right of Sol's point, inside the 0.3 its name takes on that side, and the
      // readout over the rung's text from 0.32 on, past the end of the name's.
      const sol = new THREE.Vector3(SUN.x, SUN.y, SUN.z).project(camera);
      const at = new THREE.Vector3(sol.x + 0.15 / aspect, sol.y, sol.z).unproject(camera);
      const ladder = vi
        .spyOn(
          GalaxySystemSceneComponent.prototype as unknown as { ringLabels: () => LabeledPoint[] },
          'ringLabels',
        )
        .mockReturnValue([
          {
            id: `ring-250`,
            name: '250 pc',
            kind: 'Survey edge',
            tone: 'ghost',
            x: at.x,
            y: at.y,
            z: at.z,
          },
        ]);
      const px = (x: number, y: number) => [(x + aspect) * 450, (1 - y) * 450];
      const [left, top] = px(sol.x * aspect + 0.32, sol.y + 0.05);
      const [right, bottom] = px(sol.x * aspect + 0.4, sol.y - 0.05);
      (fixture.nativeElement as HTMLElement).querySelector(
        '[role="tabpanel"]',
      )!.getBoundingClientRect = () => new DOMRect(left, top, right - left, bottom - top);
      await advanceFrames(engine, 0.3);

      const labels = (update.mock.calls.at(-1)?.[0] ?? []) as LabeledPoint[];
      expect(labels.map((label) => label.id)).not.toContain('ring-250');
      expect(labels.find((label) => label.id === SUN.id)?.side).toBe('right');
      update.mockRestore();
      ladder.mockRestore();
    });
  });

  it('keeps the stars of a plotted route drawn, and the selected star', async () => {
    const component = fixture.componentInstance as unknown as {
      routeResult: { set(value: unknown): void };
    };
    const refocus = vi.spyOn(StarFieldRenderer.prototype, 'refocus');
    await advanceFrames(engine, 0.3);

    component.routeResult.set({
      stars: [
        { id: SUN.id, name: 'Sol' },
        { id: PROXIMA.id, name: 'Proxima Centauri' },
      ],
      totalPc: 1.3,
      neededRangePc: null,
      gaveUp: false,
      least: true,
    });
    await advanceFrames(engine, 0.3);

    // As catalogue indices: the Sun is the first entry of STARS, Proxima the third.
    expect(refocus.mock.calls.at(-1)![0].pinned).toEqual([0, 2]);
    refocus.mockRestore();
  });

  describe('the jump-link graph', () => {
    type LinkScene = {
      routing: {
        links(rangePc: number, drawn: Uint32Array, budget?: LinkBudget): Promise<Float32Array>;
        route(): Promise<never>;
        dispose(): void;
      };
      display: { update(change: (display: { jumpLinks: boolean }) => unknown): void };
      jumpRangePc: { set(rangePc: number): void };
      routeResult: { set(value: unknown): void };
      controls: { target: THREE.Vector3 };
      starField: { drawnStars: Uint32Array; drawn: Uint32Array };
    };
    /** Real time, since the rebuild waits on a real timer for the range and the drawn stars to settle. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

    /** The view's distance from its centre at which its frame is 20 pc tall: well inside the widest the graph is drawn in. */
    const LINKED_VIEW_DISTANCE = 10 / Math.tan((50 * Math.PI) / 360);

    function linkScene(
      links: LinkScene['routing']['links'],
      distance = LINKED_VIEW_DISTANCE,
    ): LinkScene {
      const component = fixture.componentInstance as unknown as LinkScene;
      component.routing = {
        links,
        route: () => new Promise<never>(() => undefined),
        dispose: () => undefined,
      };
      engine
        .getCamera()
        .position.sub(component.controls.target)
        .setLength(distance)
        .add(component.controls.target);
      component.display.update((display) => ({ ...display, jumpLinks: true }));
      TestBed.tick();
      return component;
    }

    /** Makes the next refocus choose a different set: the field is told it draws one star, then the view moves, camera and all. */
    async function changeDrawnStars(component: LinkScene, targetX: number): Promise<void> {
      component.starField.drawn = Uint32Array.of(0);
      engine.getCamera().position.x += targetX - component.controls.target.x;
      component.controls.target.set(targetX, 0, 0);
      await advanceFrames(engine, 0.3);
    }

    it('draws no graph at the opening view, where it is a solid disc over the Sun, and asks once the view zooms in', async () => {
      const links = vi.fn<LinkScene['routing']['links']>(() =>
        Promise.resolve(new Float32Array(6)),
      );
      const setSegments = vi.spyOn(JumpLinkRenderer.prototype, 'setSegments');
      const opening = engine.getCamera().position.length();
      const component = linkScene(links, opening);
      await advanceFrames(engine, 0.3);
      await settle();
      expect(links).not.toHaveBeenCalled();

      engine
        .getCamera()
        .position.sub(component.controls.target)
        .setLength(LINKED_VIEW_DISTANCE)
        .add(component.controls.target);
      await advanceFrames(engine, 0.3);
      await settle();
      expect(links).toHaveBeenCalledTimes(1);
      await flushAsync();
      expect(setSegments.mock.lastCall?.[0]).toHaveLength(6);

      // Back out: the graph comes off the screen rather than staying as it was.
      engine
        .getCamera()
        .position.sub(component.controls.target)
        .setLength(opening)
        .add(component.controls.target);
      await advanceFrames(engine, 0.3);
      await settle();
      expect(links).toHaveBeenCalledTimes(1);
      expect(setSegments.mock.lastCall?.[0]).toHaveLength(0);
      setSegments.mockRestore();
    });

    it('links the stars being drawn, and asks again once a new set of them holds still', async () => {
      const links = vi.fn<LinkScene['routing']['links']>(() =>
        Promise.resolve(new Float32Array(0)),
      );
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
      component.routeResult.set({
        stars: [{ id: SUN.id, name: 'Sol' }],
        totalPc: 0,
        neededRangePc: null,
        gaveUp: false,
        least: true,
      });
      await advanceFrames(engine, 0.3);
      await settle();
      expect(links).toHaveBeenCalledTimes(2);
    });

    it('asks for as much of the graph as a million pixels of line make, around where the view is centred', async () => {
      const links = vi.fn<LinkScene['routing']['links']>(() =>
        Promise.resolve(new Float32Array(0)),
      );
      Object.defineProperty(
        (fixture.nativeElement as HTMLElement).querySelector('canvas')!,
        'clientHeight',
        { value: 1080 },
      );
      // A screen scaled to 200%: 1080 CSS pixels are 2160 drawn ones, and the lines are drawn in those.
      engine.pixelRatio = 2;
      linkScene(links);
      await settle();

      const budget = links.mock.calls[0][2];
      // The view is centred on the Sun: its frame's half-height there, over 1080 drawn pixels, is a pixel's worth of parsecs.
      const halfHeight = engine.getCamera().position.length() * Math.tan((50 * Math.PI) / 360);
      expect(budget?.centre).toEqual({ x: 0, y: 0, z: 0 });
      expect(budget?.lengthPc).toBeCloseTo((1_000_000 * halfHeight) / 1080, 3);
    });

    it('asks again once the view has zoomed past the budget it asked with, though the drawn stars are the same', async () => {
      // All three stars fit the star budget, so the drawn set never changes: only the budget can.
      const links = vi.fn<LinkScene['routing']['links']>(() =>
        Promise.resolve(new Float32Array(0)),
      );
      Object.defineProperty(
        (fixture.nativeElement as HTMLElement).querySelector('canvas')!,
        'clientHeight',
        { value: 1080 },
      );
      const component = linkScene(links);
      await advanceFrames(engine, 0.3);
      await settle();
      const asked = links.mock.calls.length;

      const camera = engine.getCamera();
      camera.position
        .sub(component.controls.target)
        .multiplyScalar(0.5)
        .add(component.controls.target);
      await advanceFrames(engine, 0.3);
      await settle();

      expect(links.mock.calls).toHaveLength(asked + 1);
      expect(links.mock.calls.at(-1)![1]).toBe(links.mock.calls[0][1]);
    });

    it('asks for no graph from inside a system, where distances are in astronomical units', async () => {
      const links = vi.fn<LinkScene['routing']['links']>(() =>
        Promise.resolve(new Float32Array(0)),
      );
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
      const pending: Array<{
        resolve: (segments: Float32Array) => void;
        reject: (error: Error) => void;
      }> = [];
      const setSegments = vi.spyOn(JumpLinkRenderer.prototype, 'setSegments');
      const component = linkScene(
        () => new Promise<Float32Array>((resolve, reject) => pending.push({ resolve, reject })),
      );
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
      const links = vi.fn<LinkScene['routing']['links']>(() =>
        Promise.resolve(new Float32Array(0)),
      );
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
      const component = linkScene(
        () => new Promise<Float32Array>((resolve) => answers.push(resolve)),
      );
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
    type Answer = {
      route: { stars: number[]; totalPc: number; longestHopPc: number } | null;
      neededRangePc: number | null;
      gaveUp: boolean;
      least: boolean;
    };
    const answers: Array<(answer: Answer) => void> = [];
    const component = fixture.componentInstance as unknown as {
      routing: { route(): Promise<Answer>; links(): Promise<Float32Array>; dispose(): void };
      routePending(): boolean;
      routeResult(): {
        stars: { id: number; name: string; legPc: number }[];
        gaveUp: boolean;
      } | null;
      onRouteRequested(request: { fromId: number; toId: number; rangePc: number }): void;
    };
    component.routing = {
      route: () => new Promise<Answer>((resolve) => answers.push(resolve)),
      links: () => Promise.resolve(new Float32Array(0)),
      dispose: () => undefined,
    };

    component.onRouteRequested({ fromId: SUN.id, toId: ALPHA_CENTAURI.id, rangePc: 2 });
    component.onRouteRequested({ fromId: SUN.id, toId: PROXIMA.id, rangePc: 2 });
    expect(component.routePending()).toBe(true);

    answers[1]({
      route: { stars: [SUN.id, PROXIMA.id], totalPc: 1.3, longestHopPc: 1.3 },
      neededRangePc: null,
      gaveUp: false,
      least: true,
    });
    await flushAsync();
    answers[0]({
      route: { stars: [SUN.id, ALPHA_CENTAURI.id], totalPc: 1.34, longestHopPc: 1.34 },
      neededRangePc: null,
      gaveUp: false,
      least: true,
    });
    await flushAsync();

    expect(component.routeResult()?.stars.map((star) => star.id)).toEqual([SUN.id, PROXIMA.id]);
    // Named and measured from the catalogue the scene holds, for the panel to list.
    expect(component.routeResult()?.stars.map(({ name, legPc }) => [name, legPc])).toEqual([
      ['Sol', 0],
      ['Proxima Centauri', 1.3],
    ]);
    expect(component.routePending()).toBe(false);

    // "It gave up" travels to the panel, which says something else for it than for "there is none".
    component.onRouteRequested({ fromId: SUN.id, toId: ALPHA_CENTAURI.id, rangePc: 0.5 });
    answers[2]({ route: null, neededRangePc: null, gaveUp: true, least: false });
    await flushAsync();
    expect(component.routeResult()).toMatchObject({ stars: [], gaveUp: true });
  });

  it('releases the routes panel when a route cannot be worked out, so it can be tried again', async () => {
    const component = fixture.componentInstance as unknown as {
      routing: { route(): Promise<never>; links(): Promise<Float32Array>; dispose(): void };
      routePending(): boolean;
      onRouteRequested(request: { fromId: number; toId: number; rangePc: number }): void;
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    component.routing = {
      route: () => Promise.reject(new Error('worker gone')),
      links: () => Promise.resolve(new Float32Array(0)),
      dispose: () => undefined,
    };

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
      spreadLabels(
        candidates: Iterable<{ id: number; name: string; x: number; y: number; z: number }>,
        camera: THREE.Camera,
        keepId: null,
      ): unknown[];
    };
    const camera = engine.getCamera();
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let pulled = 0;
    const grid = function* () {
      for (let row = 0; row < 5; row++) {
        for (let column = 0; column < 5; column++) {
          pulled++;
          // A name's reach apart and clear of the right edge, so every one of them is placed.
          const point = new THREE.Vector3(-0.9 + column * 0.35, -0.8 + row * 0.4, 0.5).unproject(
            camera,
          );
          yield {
            id: row * 5 + column,
            name: `label-${pulled}`,
            x: point.x,
            y: point.y,
            z: point.z,
          };
        }
      }
    };

    expect(component.spreadLabels(grid(), camera, null)).toHaveLength(15);
    expect(pulled).toBe(15);
  });

  describe('where a name is printed', () => {
    type Spreading = {
      spreadLabels(
        candidates: Iterable<LabeledPoint>,
        camera: THREE.Camera,
        keepId: number | string | null,
        placed?: readonly LabeledPoint[],
      ): LabeledPoint[];
      ringLabelsInTheClear(
        candidates: readonly LabeledPoint[],
        camera: THREE.Camera,
        names: readonly LabeledPoint[],
      ): LabeledPoint[];
      cardBodyId: string | null;
    };
    let component: Spreading;
    let camera: THREE.Camera;
    const sides = (labels: LabeledPoint[]) => labels.map((label) => `${label.id}:${label.side}`);
    // A point on a 1600x900 canvas, from x in the aspect-scaled NDC the label pass works in.
    let at: (id: number | string, x: number, y: number) => LabeledPoint;

    beforeEach(() => {
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      Object.defineProperty(canvas, 'clientWidth', { value: 1600 });
      Object.defineProperty(canvas, 'clientHeight', { value: 900 });
      canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1600, 900);
      component = fixture.componentInstance as unknown as Spreading;
      camera = engine.getCamera();
      camera.updateMatrixWorld(true);
      at = (id, x, y) => {
        const point = new THREE.Vector3(x / (1600 / 900), y, 0.5).unproject(camera);
        return { id, name: `label-${id}`, x: point.x, y: point.y, z: point.z };
      };
    });

    it('keeps a name off the text of one placed on either side of it, on its other side or not at all', () => {
      // Every anchor is further from the others than the 0.12 two names keep: it is the text,
      // up to 0.3 of it, that runs into the next name.
      expect(
        sides(
          component.spreadLabels(
            [
              at(1, 0, 0),
              at(2, 0.5, 0),
              // Between the two: its right runs into 2's name and its left into 1's.
              at(3, 0.25, 0),
              // 1's name to its right, nothing to its left.
              at(4, -0.2, 0),
              // Over the end of 1's name, a row up: clear of it.
              at(5, 0.15, 0.1),
            ],
            camera,
            null,
          ),
        ),
      ).toEqual(['1:right', '2:right', '4:left', '5:right']);
      // A name only right-hung ones sit left of used to print into: 1's text runs through it.
      expect(
        component.spreadLabels([at(6, 0.2, 0)], camera, null, [{ ...at(1, 0, 0), side: 'right' }]),
      ).toEqual([]);
    });

    it('keeps the selection’s name though neither side is clear, and hangs the card’s body left or not at all', () => {
      // 3 again, boxed in on both sides, but the star about to be flown to.
      expect(
        sides(component.spreadLabels([at(1, 0, 0), at(2, 0.5, 0), at(3, 0.25, 0)], camera, 3)),
      ).toEqual(['1:right', '2:right', '3:right']);

      // The leader to the card leaves the body's right: left with the right clear, and nowhere
      // once something takes its left.
      component.cardBodyId = 'earth';
      expect(sides(component.spreadLabels([at('earth', 0, 0)], camera, null))).toEqual([
        'earth:left',
      ]);
      expect(component.spreadLabels([at('earth', 0, 0)], camera, null, [at(1, -0.2, 0)])).toEqual(
        [],
      );
    });

    it('keeps a name out from under the HUD and inside the frame', async () => {
      // A pass first, which names the view and so puts up the banner.
      await advanceFrames(engine, 0.3);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const box = (selector: string, rect: DOMRect) => {
        const element = host.querySelector(selector)!;
        expect(element).not.toBeNull();
        element.getBoundingClientRect = () => rect;
      };
      box('[role="tabpanel"]', new DOMRect(24, 600, 512, 260));
      box('[data-testid="hud-banner"]', new DOMRect(760, 24, 400, 30));
      box('nav[aria-label="Map scale"]', new DOMRect(24, 24, 360, 30));
      // Read on the next label pass.
      await advanceFrames(engine, 0.3);
      // From pixels on the canvas.
      const px = (id: number, x: number, y: number) =>
        at(id, (2 * x) / 900 - 1600 / 900, 1 - (2 * y) / 900);

      const placed = component.spreadLabels(
        [
          px(1, 200, 700), // under the readout
          px(2, 900, 39), // under the banner
          px(3, 100, 39), // under the scale ladder
          px(4, 1400, 5), // its point on the frame, its text over the top
          px(5, 1590, 450), // too near the right edge for its text to hang there
          px(6, 1000, 400), // clear
          px(9, 1000, 897), // its point on the frame, its text under the bottom
        ],
        camera,
        null,
      );

      expect(placed.map((label) => `${label.id}:${label.side}`)).toEqual(['5:left', '6:right']);
      // Near the left edge, with its right taken: the left would run off the frame, so nowhere.
      expect(component.spreadLabels([px(10, 5, 300)], camera, null, [px(11, 80, 300)])).toEqual([]);
      // A distance on a ring as much as a name.
      expect(
        component
          .ringLabelsInTheClear([px(7, 200, 700), px(8, 1000, 300)], camera, [])
          .map((label) => label.id),
      ).toEqual([8]);
    });

    it('measures a name by its own text where that reaches further than the least reach', () => {
      // 0.35 inside the right edge: room for the 0.3 every name is given, not for a neighbour's
      // name and distance, which reach 214 px from the point, 0.48 of the frame at 900 px.
      const nearEdge = at('neighbour:70890', 1600 / 900 - 0.35, 0);
      const neighbour: LabeledPoint = {
        ...nearEdge,
        name: 'Proxima Centauri',
        distance: '1.30 pc',
        tone: 'ghost',
      };
      expect(component.spreadLabels([neighbour], camera, null).map((label) => label.side)).toEqual([
        'left',
      ]);
      expect(
        component
          .spreadLabels([{ ...nearEdge, name: 'Sirius' }], camera, null)
          .map((label) => label.side),
      ).toEqual(['right']);
    });
  });

  describe('on a 1280x720 canvas', () => {
    type Spreading = {
      spreadLabels(
        candidates: Iterable<LabeledPoint>,
        camera: THREE.Camera,
        keepId: null,
      ): LabeledPoint[];
      ringLabelsInTheClear(
        candidates: readonly LabeledPoint[],
        camera: THREE.Camera,
        names: readonly LabeledPoint[],
      ): LabeledPoint[];
    };
    let component: Spreading;
    let camera: THREE.Camera;
    let at: (
      id: number | string,
      name: string,
      x: number,
      y: number,
      kind?: string,
    ) => LabeledPoint;

    beforeEach(() => {
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      Object.defineProperty(canvas, 'clientWidth', { value: 1280 });
      Object.defineProperty(canvas, 'clientHeight', { value: 720 });
      component = fixture.componentInstance as unknown as Spreading;
      camera = engine.getCamera();
      camera.updateMatrixWorld(true);
      at = (id, name, x, y, kind) => {
        const point = new THREE.Vector3(x / (1280 / 720), y, 0.5).unproject(camera);
        return { id, name, ...(kind ? { kind } : {}), x: point.x, y: point.y, z: point.z };
      };
    });

    it('keeps names and rungs a row of their own text apart, where that is taller than the least row', () => {
      const ids = (labels: LabeledPoint[]) => labels.map((label) => label.id);
      // Two lines are 22.65 px, 0.063 of the frame here: 0.062 up clears the least row, 0.06, and
      // still prints into the name below. Its left runs into that name too.
      expect(
        ids(
          component.spreadLabels(
            [at(1, 'Sirius', 0, 0, 'Star'), at(2, 'Vega', 0.15, 0.062, 'Star')],
            camera,
            null,
          ),
        ),
      ).toEqual([1]);
      // A distance is one line, 12.65 px, 0.035 here, against half the least row, 0.03.
      expect(
        ids(
          component.ringLabelsInTheClear(
            [at('ring-12', '12 pc', 0, 0), at('ring-14', '14 pc', 0, 0.032)],
            camera,
            [],
          ),
        ),
      ).toEqual(['ring-12']);
      // "Groombridge 34" reaches 125 px, 0.35 here: a rung 0.32 along is past the least reach and
      // still under the name.
      expect(
        component.ringLabelsInTheClear([at('ring-16', '16 pc', 0.32, 0)], camera, [
          at(3, 'Groombridge 34', 0, 0, 'Star'),
        ]),
      ).toEqual([]);
    });

    it('measures a rung by its kind line where that is wider than its distance', () => {
      // "Survey edge" is 99 px, 0.276 here, past the 0.23 every rung is given; "250 pc" is 65.
      // A name 0.25 along, 90 px, is under the one and clear of the other.
      const name = at(1, 'Sirius', 0.25, 0, 'Star');
      expect(
        component.ringLabelsInTheClear([at('ring-250', '250 pc', 0, 0, 'Survey edge')], camera, [
          name,
        ]),
      ).toEqual([]);
      expect(
        component
          .ringLabelsInTheClear([at('ring-250', '250 pc', 0, 0)], camera, [name])
          .map((label) => label.id),
      ).toEqual(['ring-250']);
    });
  });

  describe('on a 390x844 phone', () => {
    it('stacks a neighbour’s distance under its name where the one line fits on neither side, and keeps it', () => {
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      Object.defineProperty(canvas, 'clientWidth', { value: 390 });
      Object.defineProperty(canvas, 'clientHeight', { value: 844 });
      const component = fixture.componentInstance as unknown as {
        spreadLabels(
          candidates: Iterable<LabeledPoint>,
          camera: THREE.Camera,
          keepId: null,
        ): LabeledPoint[];
      };
      const camera = engine.getCamera();
      camera.updateMatrixWorld(true);
      const centre = new THREE.Vector3(0, 0, 0.5).unproject(camera);
      const neighbour = (id: number, name: string, distance: string): LabeledPoint => ({
        id: `neighbour:${id}`,
        name,
        distance,
        tone: 'ghost',
        selectStarId: id,
        x: centre.x,
        y: centre.y,
        z: centre.z,
      });
      const form = (labels: LabeledPoint[]) =>
        labels.map((label) => `${label.side}:${label.stacked ?? false}`);

      // "Barnard's Star · 1.83 pc" is 199.5 px, 0.47 of the frame either way from the middle of a
      // frame 0.46 wide on each side; "Barnard's Star" over "1.83 pc" is 125 px.
      expect(
        form(component.spreadLabels([neighbour(2, "Barnard's Star", '1.83 pc')], camera, null)),
      ).toEqual(['right:true']);
      // One that fits on one line keeps it.
      expect(form(component.spreadLabels([neighbour(3, 'Sol', '1.30 pc')], camera, null))).toEqual([
        'right:false',
      ]);
    });
  });

  it('places the deep-sky names after the star names and around them, outside their count', async () => {
    type Spread = { spreadLabels: (...args: unknown[]) => LabeledPoint[] };
    const spread = vi.spyOn(
      GalaxySystemSceneComponent.prototype as unknown as Spread,
      'spreadLabels',
    );
    const rings = vi.spyOn(
      GalaxySystemSceneComponent.prototype as unknown as {
        ringLabelsInTheClear: (...args: unknown[]) => LabeledPoint[];
      },
      'ringLabelsInTheClear',
    );
    // No ladder: at this pose the 250 pc rung, placed before the names, takes Sol's place.
    const ladder = vi
      .spyOn(
        GalaxySystemSceneComponent.prototype as unknown as { ringLabels: () => LabeledPoint[] },
        'ringLabels',
      )
      .mockReturnValue([]);
    const update = vi.spyOn(StarLabelOverlay.prototype, 'update');
    // A deep-sky object in the open, where the test's one (Andromeda, straight up) is not.
    const camera = engine.getCamera();
    camera.updateMatrixWorld(true);
    const toward = new THREE.Vector3(0.5, -0.5, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    const open = camera.position.clone().addScaledVector(toward, camera.position.length());
    (fixture.componentInstance as unknown as { deepSkyLabels: LabeledPoint[] }).deepSkyLabels = [
      { id: 'M42', name: 'Orion Nebula', kind: 'Nebula', x: open.x, y: open.y, z: open.z },
    ];
    await advanceFrames(engine, 0.3);

    // The last pass: the stars, then the deep-sky objects around what the stars took.
    const [stars, backdrop] = spread.mock.results
      .slice(-2)
      .map((result) => result.value as LabeledPoint[]);
    expect(stars.length).toBeGreaterThan(0);
    expect(spread.mock.calls.at(-1)?.[3]).toEqual(expect.arrayContaining(stars));
    const shown = (update.mock.calls.at(-1)?.[0] ?? []) as LabeledPoint[];
    expect(
      shown.filter((label) => typeof label.id === 'string' && !label.id.startsWith('ring-')),
    ).toEqual(backdrop);
    // The ring distances keep out of both, a deep-sky name as much as a star's.
    expect(backdrop.length).toBeGreaterThan(0);
    expect(rings.mock.calls.at(-1)?.[2]).toEqual(expect.arrayContaining([...stars, ...backdrop]));
    spread.mockRestore();
    rings.mockRestore();
    ladder.mockRestore();
    update.mockRestore();
  });

  it('offers every star it names in the field as somewhere to go, as a neighbour’s name is from a system', async () => {
    const update = vi.spyOn(StarLabelOverlay.prototype, 'update');
    await advanceFrames(engine, 0.3);

    const stars = ((update.mock.calls.at(-1)?.[0] ?? []) as LabeledPoint[]).filter(
      (label) => typeof label.id === 'number',
    );
    expect(stars.length).toBeGreaterThan(0);
    expect(stars.every((label) => label.selectStarId === label.id)).toBe(true);
    update.mockRestore();
  });

  it('flies the camera into a selected star system: hides the galaxy group, shows the system group, and switches to AU-scale near/far planes', async () => {
    navigationStore.selectStar(SUN.id);
    await flushAsync();

    // Approach leg (parsec space) + settle leg (AU space) with margin.
    await advanceFrames(engine, 2.5);

    const component = fixture.componentInstance as unknown as {
      galaxyGroup: THREE.Group;
      systemGroup: THREE.Group;
    };
    expect(component.galaxyGroup.visible).toBe(false);
    expect(component.systemGroup.visible).toBe(true);
    expect(engine.getCamera().near).toBeCloseTo(0.002, 9);
    expect(navigationStore.viewLevel()).toBe('system');
  });

  it('prints how far each neighbour is on its name’s own line, not under it', async () => {
    const update = vi.spyOn(StarLabelOverlay.prototype, 'update');
    navigationStore.selectStar(SUN.id);
    await flushAsync();
    await advanceFrames(engine, 2.5);

    const labels = update.mock.calls.flatMap(([points]) => points as LabeledPoint[]);
    const proxima = labels.filter((label) => label.id === `neighbour:${PROXIMA.id}`).at(-1);
    expect(proxima).toMatchObject({
      name: 'Proxima Centauri',
      distance: '1.30 pc',
      tone: 'ghost',
      selectStarId: PROXIMA.id,
    });
    expect(proxima?.kind).toBeUndefined();
    update.mockRestore();
  });

  it('says where a system’s orbits come from, and for the Sun how long they hold', async () => {
    const note = (): string =>
      (fixture.componentInstance as unknown as { hudNote: () => string }).hudNote();
    navigationStore.selectStar(SUN.id);
    await flushAsync();
    await advanceFrames(engine, 2.5);
    expect(note()).toMatch(
      /^Orbits propagated from JPL mean elements, the planets’ fit for 3000 BC to AD 3000 and the moons’ checked from 1950 to 2100, and the SBDB’s osculating ones for Ceres, Eris, Haumea and Makemake, checked over the same span, to now, \d{4}-\d\d-\d\d \d\d:\d\d UTC\.$/,
    );

    navigationStore.selectStar(ALPHA_CENTAURI.id);
    await flushAsync();
    await advanceFrames(engine, 5);
    expect(note()).toMatch(
      /^Orbits propagated from published elements to now, \d{4}-\d\d-\d\d \d\d:\d\d UTC\.$/,
    );
  });

  it('turns the Sun about its IAU pole, once in 25.38 days', async () => {
    const time = TestBed.inject(TimeStore);
    time.setRate(0);
    time.setDate(new Date('2026-01-01T00:00Z'));
    navigationStore.selectStar(SUN.id);
    await flushAsync();
    await advanceFrames(engine, 2.5);
    const sun = (): THREE.Object3D =>
      (fixture.componentInstance as unknown as { starMarker: THREE.Object3D }).starMarker;
    const turned = (local: THREE.Vector3): THREE.Vector3 =>
      local.applyQuaternion(sun().getWorldQuaternion(new THREE.Quaternion()));

    // The sphere's +Y, which MAP_TO_BODY carries onto the body's pole, at RA 286.13, Dec 63.87.
    const ra = (286.13 * Math.PI) / 180;
    const dec = (63.87 * Math.PI) / 180;
    const pole = new THREE.Vector3(
      Math.cos(dec) * Math.cos(ra),
      Math.cos(dec) * Math.sin(ra),
      Math.sin(dec),
    );
    expect(turned(new THREE.Vector3(0, 1, 0)).angleTo(pole)).toBeLessThan(1e-6);

    const before = turned(new THREE.Vector3(1, 0, 0));
    time.setDate(new Date('2026-01-02T00:00Z'));
    await advanceFrames(engine, 0.1);
    expect((turned(new THREE.Vector3(1, 0, 0)).angleTo(before) * 180) / Math.PI).toBeCloseTo(
      14.1844,
      3,
    );
  });

  it('names the date the system is drawn for once the clock is set to one', async () => {
    const note = (): string =>
      (fixture.componentInstance as unknown as { hudNote: () => string }).hudNote();
    TestBed.inject(TimeStore).setDate(new Date('2020-12-21T18:00Z'));
    navigationStore.selectStar(SUN.id);
    await flushAsync();
    await advanceFrames(engine, 2.5);
    // The great conjunction, to the minute: not "now", and not a date the reader has to find.
    expect(note()).toMatch(/ to 2020-12-21 18:00 UTC\.$/);
  });

  describe('with Eris, whose aphelion runs past the grid', () => {
    type FramedScene = {
      bodies: BodyRecord[];
      controls: { target: THREE.Vector3 };
      systemRenderer: SystemOrbitsRenderer;
      systemGroup: THREE.Group;
    };
    // Its 67.9 AU axis gives the grid an 80 AU outer ring; at aphelion it is 97.7 AU out.
    const ERIS: BodyRecord = {
      ...EARTH,
      id: 'eris',
      name: 'Eris',
      kind: 'dwarf',
      radiusKm: 1163,
      orbit: { ...EARTH.orbit, semiMajorAxisAu: 67.934, eccentricity: 0.4382 },
      rates: keplerRates(67.934, GM_SUN_AU3_PER_DAY2),
    };

    async function enterTheSun(aspect: number): Promise<FramedScene> {
      const component = fixture.componentInstance as unknown as FramedScene;
      component.bodies = [EARTH, ERIS];
      engine.getPerspectiveCamera().aspect = aspect;
      navigationStore.selectStar(SUN.id);
      await flushAsync();
      await advanceFrames(engine, 2.5);
      return component;
    }

    it('frames the furthest the system draws, Eris’s aphelion, not the ring inside it nor its semi-major axis', async () => {
      const component = await enterTheSun(1);
      const camera = engine.getPerspectiveCamera();
      expect(component.systemRenderer.outermostRadiusAu).toBeCloseTo(67.934 * 1.4382, 9);
      // 234.7 AU; framed on the 67.9 AU axis the camera would stand at 163 AU and Eris arrive off screen.
      expect(camera.position.distanceTo(component.controls.target)).toBeCloseTo(
        systemFramingDistanceAu(component.systemRenderer.outermostRadiusAu, {
          fovDegrees: camera.fov,
          aspect: camera.aspect,
        }),
        6,
      );
    });

    it('holds Earth to its 3-pixel floor at the arrival framing, where its true radius is far under a pixel', async () => {
      Object.defineProperty(
        (fixture.nativeElement as HTMLElement).querySelector('canvas')!,
        'clientHeight',
        { value: 1000 },
      );
      const component = await enterTheSun(1.6);
      const earth = component.systemRenderer.members.find((member) => member.id === 'earth')!
        .marker as THREE.Mesh;
      const pixelAu =
        (2 *
          engine.visibleHalfHeight(
            engine.getCamera().position.distanceTo(earth.getWorldPosition(new THREE.Vector3())),
          )) /
        1000;
      expect(
        (earth.scale.x * (earth.geometry as THREE.SphereGeometry).parameters.radius) / pixelAu,
      ).toBeCloseTo(3, 3);
    });

    it('shows Earth’s card on a hover 11 px from its centre, 8 px off its disc, and pins it on a click there', async () => {
      // A raycast had to land on the 3-pixel disc itself.
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      Object.defineProperty(canvas, 'clientWidth', { value: 1600 });
      Object.defineProperty(canvas, 'clientHeight', { value: 1000 });
      canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1600, 1000);
      const component = await enterTheSun(1.6);
      const earth = component.systemRenderer.members
        .find((member) => member.id === 'earth')!
        .marker.getWorldPosition(new THREE.Vector3())
        .project(engine.getCamera());
      const at = { clientX: ((earth.x + 1) / 2) * 1600 + 11, clientY: ((1 - earth.y) / 2) * 1000 };
      const card = (): { name: string } | undefined =>
        (component as unknown as { objectCard(): { name: string } | undefined }).objectCard();

      canvas.dispatchEvent(new MouseEvent('pointermove', at));
      expect(card()?.name).toBe('Earth');
      canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 0 }));
      expect(card()).toBeUndefined();

      canvas.dispatchEvent(new MouseEvent('click', at));
      expect(navigationStore.selectedBodyId()).toBe('earth');
      expect(card()?.name).toBe('Earth');

      // Escape takes the card away before anything in the dock: the panel stays as it was.
      fixture.detectChanges();
      const dock = fixture.debugElement.query(By.directive(HudDockComponent))
        .componentInstance as HudDockComponent;
      const tab = dock.activeTab();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(card()).toBeUndefined();
      expect(dock.activeTab()).toBe(tab);
    });

    it('leaves the system outwards even from a phone’s framing, which stands past the 400 AU it used to fly to', async () => {
      const component = await enterTheSun(390 / 844);
      const camera = engine.getCamera();
      const arrival = camera.position.length();
      expect(arrival).toBeGreaterThan(500);

      navigationStore.selectStar(null);
      await flushAsync(1);
      // Until the swap: it flew 508 AU in to 400, and the system grew on screen while the reader left it.
      let previous = arrival;
      for (let frame = 0; frame < 100 && component.systemGroup.visible; frame++) {
        engine.tick(0.05);
        await flushAsync(1);
        if (component.systemGroup.visible) {
          expect(camera.position.length()).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = camera.position.length();
        }
      }
      expect(component.systemGroup.visible).toBe(false);
      expect(previous).toBeGreaterThan(arrival);
    });
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

    const component = fixture.componentInstance as unknown as {
      galaxyGroup: THREE.Group;
      systemGroup: THREE.Group;
    };
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

    const component = fixture.componentInstance as unknown as {
      currentStarId: number | null;
      systemGroup: THREE.Group;
    };
    expect(component.currentStarId).toBeNull();
    expect(component.systemGroup.visible).toBe(false);
    expect(navigationStore.viewLevel()).toBe('galactic');
  });

  describe('a deep-sky object picked in the search', () => {
    interface SkyScene {
      currentStarId: number | null;
      controls: { target: THREE.Vector3 };
      deepSky: DeepSkyRenderer;
      deepSkyRecords: readonly DeepSkyRecord[];
      deepSkyLabels: readonly LabeledPoint[];
    }
    const scene = (): SkyScene => fixture.componentInstance as unknown as SkyScene;
    /** Where the view looks: from the camera through the orbit's centre. */
    const lookingAlong = (): THREE.Vector3 =>
      scene().controls.target.clone().sub(engine.getCamera().position).normalize();

    it('turns the view toward it from beside the Sun, where the backdrop is the sky seen from the Sun', async () => {
      navigationStore.lookAtDeepSky(DEEP_SKY_OBJECT.id);
      await flushAsync();
      await advanceFrames(engine, 1.5);

      // Andromeda lies along +z: the view looks that way from a parsec out, the Sun behind it.
      expect(lookingAlong().z).toBeCloseTo(1, 5);
      expect(engine.getCamera().position.z).toBeCloseTo(1, 5);
      // Taken up, so asking for it again turns the view again.
      expect(navigationStore.deepSkyTarget()).toBeNull();
    });

    it('shows its record in the readout while the view faces it, and the neighbourhood once it turns away', async () => {
      const hud = fixture.componentInstance as unknown as {
        hudTitle(): string;
        hudReadouts(): unknown;
      };
      navigationStore.lookAtDeepSky(DEEP_SKY_OBJECT.id);
      await flushAsync();
      await advanceFrames(engine, 1.5);
      expect(hud.hudTitle()).toBe('Andromeda Galaxy');
      expect(hud.hudReadouts()).toEqual(deepSkyReadouts(DEEP_SKY_OBJECT).readouts);

      // Turned a quarter round, toward +x: what the view shows is no longer the galaxy.
      scene()
        .controls.target.copy(engine.getCamera().position)
        .add(new THREE.Vector3(1, 0, 0));
      await advanceFrames(engine, 0.5);
      expect(hud.hudTitle()).toBe('Local Stars');
    });

    it('names it on the backdrop though it is not among the brightest that always are', async () => {
      const faint: DeepSkyRecord = {
        ...DEEP_SKY_OBJECT,
        id: 'NGC7293',
        name: 'Helix Nebula',
        kind: 'nebula',
        x: 1,
        z: 0,
        magnitude: 7.6,
        messier: null,
      };
      const records = [
        ...Array.from({ length: 12 }, (_, i) => ({
          ...DEEP_SKY_OBJECT,
          id: `B${i}`,
          magnitude: i,
        })),
        faint,
      ];
      scene().deepSkyRecords = records;
      scene().deepSky = new DeepSkyRenderer(records);
      navigationStore.lookAtDeepSky('NGC7293');
      await flushAsync();

      expect(scene().deepSkyLabels.map((label) => label.id)).toContain('NGC7293');
      expect(scene().deepSkyLabels).toHaveLength(13);
    });

    it('drops a permanent label so close on the sky that the two would print over each other', async () => {
      // The Great Orion Nebula is 0.52° from Lower Sword, which is always named.
      const sword: DeepSkyRecord = {
        ...DEEP_SKY_OBJECT,
        id: 'NGC1980',
        name: 'Lower Sword',
        x: 1,
        y: 0,
        z: 0,
      };
      const nebula: DeepSkyRecord = {
        ...sword,
        id: 'NGC1976',
        name: 'Great Orion Nebula',
        y: Math.tan(THREE.MathUtils.degToRad(0.52)),
        magnitude: 13,
      };
      const records = [
        sword,
        ...Array.from({ length: 11 }, (_, i) => ({
          ...DEEP_SKY_OBJECT,
          id: `B${i}`,
          magnitude: i,
        })),
        nebula,
      ];
      scene().deepSkyRecords = records;
      scene().deepSky = new DeepSkyRenderer(records);
      navigationStore.lookAtDeepSky('NGC1976');
      await flushAsync();

      const named = scene().deepSkyLabels.map((label) => label.id);
      expect(named).toContain('NGC1976');
      expect(named).not.toContain('NGC1980');
      expect(named).toHaveLength(12);
    });

    it('turns toward one picked on the body route once the map is back, which it was not there to see', async () => {
      fixture.destroy();
      // The body route selects the planet's host, here Earth's Sun.
      navigationStore.selectStar(SUN.id);
      navigationStore.lookAtDeepSky(DEEP_SKY_OBJECT.id);
      fixture = TestBed.createComponent(GalaxySystemSceneComponent);
      fixture.detectChanges();
      await flushAsync();
      await advanceFrames(engine, 1.5);

      expect(scene().currentStarId).toBeNull();
      expect(lookingAlong().z).toBeCloseTo(1, 5);
      expect(navigationStore.deepSkyTarget()).toBeNull();
    });

    it('leaves the plan view to turn, whose frame from a parsec out would be the object sprite alone', async () => {
      fixture.componentInstance.display.update((display) => ({ ...display, plan: true }));
      TestBed.tick();
      expect(engine.currentProjection).toBe('orthographic');

      navigationStore.lookAtDeepSky(DEEP_SKY_OBJECT.id);
      await flushAsync();
      await advanceFrames(engine, 1.5);

      expect(engine.currentProjection).toBe('perspective');
      expect(fixture.componentInstance.display().plan).toBe(false);
      // Flown by the rig the swap made, so the flight lands.
      expect(engine.getCamera().position.z).toBeCloseTo(1, 5);
      expect(lookingAlong().z).toBeCloseTo(1, 5);
    });

    it('waits for a flight into a star to land before turning, rather than cutting into it', async () => {
      navigationStore.selectStar(PROXIMA.id);
      await flushAsync();
      await advanceFrames(engine, 0.3);
      navigationStore.lookAtDeepSky(DEEP_SKY_OBJECT.id);
      await flushAsync();

      // Still on its way in: taken up now, the turn would replace the approach and its landing.
      expect(navigationStore.deepSkyTarget()).toBe(DEEP_SKY_OBJECT.id);
      // In, settled, back out and turned: 1.0 + 0.9 + 0.9 + 1.1 + 1.1 s of flight.
      await advanceFrames(engine, 6);

      expect(scene().currentStarId).toBeNull();
      expect(navigationStore.deepSkyTarget()).toBeNull();
      expect(lookingAlong().z).toBeCloseTo(1, 5);
    });

    it('leaves a system first, as the scale ladder does, and then turns', async () => {
      navigationStore.selectStar(SUN.id);
      await flushAsync();
      await advanceFrames(engine, 2.5);
      expect(navigationStore.viewLevel()).toBe('system');

      navigationStore.lookAtDeepSky(DEEP_SKY_OBJECT.id);
      await flushAsync();
      await advanceFrames(engine, 6);

      expect(scene().currentStarId).toBeNull();
      expect(navigationStore.selectedStarId()).toBeNull();
      expect(lookingAlong().z).toBeCloseTo(1, 5);
    });

    it('gives way to a star chosen while the view was leaving the system for it', async () => {
      navigationStore.selectStar(SUN.id);
      await flushAsync();
      await advanceFrames(engine, 2.5);
      navigationStore.lookAtDeepSky(DEEP_SKY_OBJECT.id);
      await flushAsync();
      await advanceFrames(engine, 0.3);
      navigationStore.selectStar(PROXIMA.id);
      await flushAsync();
      await advanceFrames(engine, 8);

      expect(scene().currentStarId).toBe(PROXIMA.id);
      expect(navigationStore.deepSkyTarget()).toBeNull();
    });
  });

  it('names what the neighbourhood holds, and where the positions of the stars in it come from', async () => {
    await advanceFrames(engine, 0.3);
    const component = fixture.componentInstance as unknown as {
      hudSubtitle(): string;
      hudNote(): string;
    };
    expect(component.hudSubtitle()).toBe(catalogueCensus(STARS));
    expect(component.hudNote()).toBe(positionsNote(STARS));
    expect(component.hudNote()).toContain(
      '1 planet hosts only the NASA Exoplanet Archive places, from its distances',
    );
  });

  it('groups the digits of every count it prints, and gives the Sun’s distance from the centre as the range is given', async () => {
    await advanceFrames(engine, 0.3);
    const scene = fixture.componentInstance as unknown as {
      stars: readonly StarRecord[];
      exoplanets: readonly ExoplanetRecord[];
      enterableSystems: number;
      galacticStrength: number;
      starField: StarFieldRenderer;
      updateHud(camera: THREE.Camera): void;
      hudReadouts(): { label: string; value: string }[];
      hudNote(): string;
    };
    // The catalogue's own sizes, which no fixture this small reaches.
    scene.stars = Array.from({ length: 455_518 }, () => LENS);
    scene.exoplanets = Array.from({ length: 6_354 }, () => LENS_B);
    scene.enterableSystems = 4_737;
    vi.spyOn(scene.starField, 'drawnCount', 'get').mockReturnValue(70_000);
    const value = (label: string) =>
      scene.hudReadouts().find((readout) => readout.label === label)?.value;

    scene.updateHud(engine.getCamera());
    expect(value('Stars')).toBe('70,000 / 455,518');
    expect(value('Exoplanets')).toBe('6,354');
    expect(value('Systems')).toBe('4,737');

    scene.galacticStrength = 1;
    scene.updateHud(engine.getCamera());
    expect(value('Sun to centre')).toBe('8.2 kpc');
    expect(value('Catalogued')).toBe('455,518 stars');
    expect(scene.hudNote()).toContain('The 455,518 catalogued stars are real.');
  });

  it('offers a star for a route by its classification, and a star with none by its name alone', () => {
    const component = fixture.componentInstance as unknown as {
      routeOptions(): { id: number; subtitle: string }[];
      onRouteQuery(query: string): void;
      currentStarOption(): { subtitle: string } | null;
    };
    const optionFor = (query: string, id: number): string | undefined => {
      component.onRouteQuery(query);
      return component.routeOptions().find((option) => option.id === id)?.subtitle;
    };
    expect(optionFor('KMT-2016', LENS.id)).toBe('');
    expect(optionFor('Proxima', PROXIMA.id)).toBe('M5V');
    // Classified for the options shown only: the index holds none, where all 455 571 stars cost 140-230 ms at boot.
    expect(
      TestBed.inject(SearchIndexService)
        .stars()
        .every(({ entry }) => entry.subtitle === ''),
    ).toBe(true);
    navigationStore.selectStar(LENS.id);
    expect(component.currentStarOption()?.subtitle).toBe('');
    navigationStore.selectStar(PROXIMA.id);
    expect(component.currentStarOption()?.subtitle).toBe('M5V');
  });

  describe('from the keyboard', () => {
    type KeyedScene = { controls: { target: THREE.Vector3; enabled: boolean } };
    let canvas: HTMLCanvasElement;
    let component: KeyedScene;

    beforeEach(() => {
      canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      // OrbitControls pans by pixels of the element's height, of which jsdom lays out none.
      Object.defineProperty(canvas, 'clientHeight', { value: 900 });
      component = fixture.componentInstance as unknown as KeyedScene;
    });

    const distance = (): number =>
      engine.getCamera().position.distanceTo(component.controls.target);
    function press(on: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key,
        code: key,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      on.dispatchEvent(event);
      return event;
    }

    it('pans on the arrows while the map has focus, and leaves an arrow typed in a field to the field', () => {
      expect(canvas.tabIndex).toBe(0);
      expect(canvas.getAttribute('aria-label')).toMatch(/^Star map\./);
      const field = document.createElement('input');
      document.body.appendChild(field);
      const start = component.controls.target.clone();

      // Prevented, an arrow in Search or a route field would no longer move the caret.
      expect(press(field, 'ArrowLeft').defaultPrevented).toBe(false);
      expect(component.controls.target.equals(start)).toBe(true);

      expect(press(canvas, 'ArrowLeft').defaultPrevented).toBe(true);
      expect(component.controls.target.equals(start)).toBe(false);
      field.remove();
    });

    it('steps in on + and =, out on -, from the dock’s pair too, and leaves Ctrl, Cmd and Alt with them to the browser', async () => {
      const start = distance();
      expect(press(canvas, '+').defaultPrevented).toBe(true);
      expect(distance()).toBeCloseTo(start * 0.8, 6);
      press(canvas, '=');
      expect(distance()).toBeCloseTo(start * 0.64, 6);
      press(canvas, '-');
      expect(distance()).toBeCloseTo(start * 0.8, 6);
      // Ctrl and - is the browser's page zoom, Cmd and = or - the same on a Mac.
      expect(press(canvas, '-', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(press(canvas, '=', { metaKey: true }).defaultPrevented).toBe(false);
      expect(press(canvas, '-', { altKey: true }).defaultPrevented).toBe(false);
      expect(distance()).toBeCloseTo(start * 0.8, 6);

      await advanceFrames(engine, 0.3);
      fixture.detectChanges();
      const zoomOut = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        'button[aria-label="Zoom out"]',
      )!;
      zoomOut.click();
      expect(distance()).toBeCloseTo(start, 6);
    });

    it('leaves the camera to a flight while one is under way', async () => {
      navigationStore.selectStar(PROXIMA.id);
      await flushAsync();
      expect(component.controls.enabled).toBe(false);
      const before = distance();
      press(canvas, '+');
      expect(distance()).toBe(before);
    });
  });

  describe('each star at its own size and in its own colour', () => {
    type DrawnStar = {
      starMarkerGeometry: THREE.SphereGeometry;
      starTint: { value: THREE.Color };
      controls: { minDistance: number };
      systemRenderer: { object: THREE.Object3D };
      hudReadouts(): { label: string; value: string; derived?: boolean }[];
    };

    async function enter(star: StarRecord): Promise<DrawnStar> {
      navigationStore.selectStar(star.id);
      await flushAsync();
      await advanceFrames(engine, 2.5);
      return fixture.componentInstance as unknown as DrawnStar;
    }

    function expectColour(colour: THREE.Color, [red, green, blue]: readonly number[]): void {
      expect([colour.r, colour.g, colour.b].map((channel) => channel.toFixed(4))).toEqual(
        [red, green, blue].map((channel) => channel.toFixed(4)),
      );
    }

    it('draws a host at the radius and in the colour the archive gives it, lights its planets in its light, and says how bright it is', async () => {
      const scene = await enter(PROXIMA);
      expect(scene.starMarkerGeometry.parameters.radius).toBeCloseTo(0.141 * SUN_RADIUS_AU, 12);
      expectColour(scene.starTint.value, blackbodyColor(2900));
      const light = scene.systemRenderer.object.children.find(
        (child): child is THREE.PointLight => child instanceof THREE.PointLight,
      )!;
      expectColour(light.color, blackbodyColor(2900, SOLAR_EFFECTIVE_TEMPERATURE_K));
      expect(scene.hudReadouts().find((readout) => readout.label === 'Luminosity')).toEqual({
        label: 'Luminosity',
        value: '0.0015 L☉',
      });
      expect(scene.hudReadouts().find((readout) => readout.label === 'Radius')?.value).toBe(
        '0.141 solar radii',
      );
    });

    it("draws the disc as the Sun's photograph in the star's colour, darkened towards the limb", async () => {
      // The disc's parts, read off the material's node graph: the tint the star's temperature sets
      // and the photograph, times the limb factor, which is worked out below at a few angles.
      // Checking only that 0.6 was somewhere in the graph passed a limb brighter than the centre.
      const scene = await enter(PROXIMA);
      const colorNode = (scene as unknown as { starMarkerMaterial: THREE.MeshBasicNodeMaterial })
        .starMarkerMaterial.colorNode!;
      const nodes = new Set<THREE.Node>();
      const walk = (node: THREE.Node): void => {
        if (!nodes.has(node)) {
          nodes.add(node);
          for (const child of node.getChildren()) {
            walk(child);
          }
        }
      };
      walk(colorNode);
      const values = [...nodes].map((node) => (node as { value?: unknown }).value);
      expect(values).toContain(scene.starTint.value);
      expect(values).toContain(loadCachedTexture(SUN_TEXTURE_PATH));

      // The factor the photograph is multiplied by, as the shader computes it where the cosine
      // between the surface normal and the line of sight is `cosine`. Only the operations a limb
      // law is written with are known; anything else fails rather than being guessed at.
      type Graph = {
        isConstNode?: boolean;
        isVarNode?: boolean;
        value?: number;
        op?: string;
        method?: string;
        node: Graph;
        aNode: Graph;
        bNode: Graph;
        cNode: Graph;
      };
      const factorAt = (node: Graph, cosine: number): number => {
        const at = (child: Graph): number => factorAt(child, cosine);
        if (node.isVarNode) {
          return at(node.node);
        }
        if (node.isConstNode) {
          return node.value!;
        }
        switch (node.op ?? node.method) {
          case '+':
            return at(node.aNode) + at(node.bNode);
          case '-':
            return at(node.aNode) - at(node.bNode);
          case '*':
            return at(node.aNode) * at(node.bNode);
          case 'oneMinus':
            return 1 - at(node.aNode);
          case 'negate':
            return -at(node.aNode);
          case 'clamp':
            return Math.min(at(node.cNode), Math.max(at(node.bNode), at(node.aNode)));
          case 'dot':
            expect(node.aNode).toBe(normalView);
            expect(node.bNode).toBe(positionViewDirection);
            return cosine;
          default:
            throw new Error(
              `the limb factor has an operation the test cannot work out: ${node.op ?? node.method}`,
            );
        }
      };
      // The graph is (photograph × tint) × factor, each step held in a variable.
      const factor = (colorNode as unknown as Graph).node.bNode;
      // The Sun's linear law, 1 − 0.6 (1 − μ): the centre at full brightness, the limb at 40 %, and
      // past the silhouette, where the normal turns away, no darker than the limb.
      expect(factorAt(factor, 1)).toBeCloseTo(1, 12);
      expect(factorAt(factor, 0.5)).toBeCloseTo(0.7, 12);
      expect(factorAt(factor, 0)).toBeCloseTo(0.4, 12);
      expect(factorAt(factor, -0.3)).toBeCloseTo(0.4, 12);
    });

    it('tints a host in the star field the colour its disc is drawn in, at the temperature the archive gives it', async () => {
      // Proxima's B−V 1.8 reads 3 070 K; its disc is drawn at the archive's 2 900.
      const scene = await enter(PROXIMA);
      const field = (scene as unknown as { starField: { catalogueColors: Float32Array } }).starField
        .catalogueColors;
      const at = STARS.indexOf(PROXIMA) * 3;
      const disc = scene.starTint.value;
      expect(
        [field[at], field[at + 1], field[at + 2]].map((channel) => channel.toFixed(4)),
      ).toEqual([disc.r, disc.g, disc.b].map((channel) => channel.toFixed(4)));
    });

    it("warms a host's planets by the luminosity the archive gives it, in the system as on their own page", async () => {
      const scene = await enter(PROXIMA);
      const planet = (
        scene.systemRenderer as unknown as { members: { id: string; marker: THREE.Mesh }[] }
      ).members.find((member) => member.id === PROXIMA_B.id)!;
      // The archive's 1.51×10⁻³ L☉ puts b at 228 K, temperate. The fixture has no measured band, so
      // without it b gets no temperature and another class, as it does in the Sun's light.
      const warmed = appearanceForExoplanet(PROXIMA_B, 0.00151);
      expect(warmed.planetClass).not.toBe(appearanceForExoplanet(PROXIMA_B, null).planetClass);
      expect(warmed.planetClass).not.toBe(appearanceForExoplanet(PROXIMA_B, 1).planetClass);
      expect((planet.marker.material as THREE.MeshStandardMaterial).map).toBe(
        planetTexture(warmed, { width: 128, height: 64 }),
      );
    });

    it('keeps the camera three radii out from a supergiant drawn at the radius its type and brightness give', async () => {
      const scene = await enter(ANTARES);
      const radius = scene.starMarkerGeometry.parameters.radius;
      // 410 R☉, 1.9 AU, at M1's 3 730 K: short of the 680 Ohnaka et al. (2013) measure, whose
      // luminosity is 0.4 dex above what V gives at the catalogue's distance.
      expect(radius / SUN_RADIUS_AU).toBeGreaterThan(350);
      expect(radius / SUN_RADIUS_AU).toBeLessThan(480);
      expect(scene.controls.minDistance).toBeCloseTo(closestApproachAu(radius), 9);
      expect(scene.controls.minDistance).toBeGreaterThan(5);
      // Settled where its disc stays inside the ring of its neighbours' names, not pressed up to it.
      expect(engine.getCamera().position.length()).toBeGreaterThan(
        1.2 * scene.controls.minDistance,
      );
    });

    it("frames a supergiant on a phone by the canvas's own size, so its neighbours' names stay off its disc", async () => {
      // A 390x844 canvas: framed as on a desktop, at half the half-side, the disc reached 98 px
      // from the centre and the names hung in from their ring came to 70.
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      Object.defineProperty(canvas, 'clientWidth', { value: 390 });
      Object.defineProperty(canvas, 'clientHeight', { value: 844 });
      const scene = await enter(ANTARES);
      const camera = engine.getPerspectiveCamera();
      const gridOuterRadiusAu = (scene.systemRenderer as unknown as { gridOuterRadiusAu: number })
        .gridOuterRadiusAu;
      const radius = scene.starMarkerGeometry.parameters.radius;
      const onPhone = systemFramingDistanceAu(
        gridOuterRadiusAu,
        { fovDegrees: camera.fov, aspect: camera.aspect, shorterSidePx: 390 },
        radius,
      );
      expect(onPhone).toBeGreaterThan(
        1.5 *
          systemFramingDistanceAu(
            gridOuterRadiusAu,
            { fovDegrees: camera.fov, aspect: camera.aspect },
            radius,
          ),
      );
      expect(engine.getCamera().position.length()).toBeCloseTo(onPhone, 6);
    });

    it('frames it by the shorter side on a phone held sideways too', async () => {
      // 844x390: framed by the width, the disc took the desktop's half again, 8.49 AU out, not 14.97.
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      Object.defineProperty(canvas, 'clientWidth', { value: 844 });
      Object.defineProperty(canvas, 'clientHeight', { value: 390 });
      const scene = await enter(ANTARES);
      const camera = engine.getPerspectiveCamera();
      const gridOuterRadiusAu = (scene.systemRenderer as unknown as { gridOuterRadiusAu: number })
        .gridOuterRadiusAu;
      const radius = scene.starMarkerGeometry.parameters.radius;
      expect(engine.getCamera().position.length()).toBeCloseTo(
        systemFramingDistanceAu(
          gridOuterRadiusAu,
          { fovDegrees: camera.fov, aspect: camera.aspect, shorterSidePx: 390 },
          radius,
        ),
        6,
      );
    });

    it('draws a star nothing gives a size or temperature for as a grey point, not as the Sun', async () => {
      const scene = await enter(PROCYON_B);
      expect(scene.starMarkerGeometry.parameters.radius).toBeLessThan(SUN_RADIUS_AU / 1000);
      expectColour(scene.starTint.value, [1, 1, 1]);
      expect(scene.hudReadouts().some((readout) => readout.label === 'Radius')).toBe(false);
    });
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
