import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataLoaderService, StarField } from '../../core/data/data-loader.service';
import { EngineService, EngineTickCallback } from '../../core/engine/engine.service';
import { BodyRecord } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { bodyPageView } from '../../shared/rendering/body-orientation';
import { TimeStore } from '../../shared/state/time.store';
import { BodyDetailSceneComponent } from './body-detail-scene.component';

// jsdom has no ResizeObserver; the page only uses it to follow real layout changes.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
  observe(): void {}
  disconnect(): void {}
};

const SUN: StarRecord = { id: 0, name: 'Sol', x: 0, y: 0, z: 0, magnitude: -26.7, spectralType: 'G2V', colorIndex: 0.656 };

// Earth and Saturn as bodies.json carries them: Standish's elements and the IAU's.
const EARTH: BodyRecord = {
  id: 'earth', systemStarId: 0, name: 'Earth', kind: 'planet', radiusKm: 6371, orbitSource: 'test',
  orbit: {semiMajorAxisAu: 1.00000018, eccentricity: 0.01673163, inclinationDeg: -0.00054346, longitudeOfAscendingNodeDeg: -5.11260389, argumentOfPeriapsisDeg: 108.04266274, meanAnomalyAtEpochDeg: -2.4631431299999917, epochJd: 2451545},
  rates: {meanMotionDegPerDay: 0.9856091187759068, longitudeOfAscendingNodeDegPerDay: -0.000006604751813826146, argumentOfPeriapsisDegPerDay: 0.000015309819575633124},
  rotationalElements: {poleRaDeg: [0, -0.641, 0], poleDecDeg: [90, -0.557, 0], primeMeridianDeg: [190.147, 360.9856235, 0]}
};
const SATURN: BodyRecord = {
  id: 'saturn', systemStarId: 0, name: 'Saturn', kind: 'planet', radiusKm: 58232, orbitSource: 'test',
  orbit: {semiMajorAxisAu: 9.54149883, eccentricity: 0.05550825, inclinationDeg: 2.49424102, longitudeOfAscendingNodeDeg: 113.63998702, argumentOfPeriapsisDeg: -20.778626390000014, meanAnomalyAtEpochDeg: -42.78564733999999, epochJd: 2451545},
  rates: {meanMotionDegPerDay: 0.033459683702669406, longitudeOfAscendingNodeDegPerDay: -0.000006848734291581108, argumentOfPeriapsisDegPerDay: 0.000021682266940451745},
  rotationalElements: {poleRaDeg: [40.589, -0.036, 0], poleDecDeg: [83.537, -0.004, 0], primeMeridianDeg: [38.9, 810.7939024, 0]}
};
// Eris and Hyperion as they are shipped for this page's purposes: no IAU model, so their pages keep
// their own light; Eris's day is measured, and Hyperion tumbles and has none.
const ERIS: BodyRecord = { ...EARTH, id: 'eris', name: 'Eris', kind: 'dwarf', radiusKm: 1163, rotationalElements: undefined, rotationPeriodHours: 378.504 };
const HYPERION: BodyRecord = { ...ERIS, id: 'hyperion', name: 'Hyperion', kind: 'moon', radiusKm: 135, parentBodyId: 'saturn', rotationPeriodHours: undefined };
// Mercury as shipped, but its 0.01-degree libration: its Sun is never 0.034 degrees off its equator.
const MERCURY: BodyRecord = {
  id: 'mercury', systemStarId: 0, name: 'Mercury', kind: 'planet', radiusKm: 2439.4, orbitSource: 'test',
  orbit: {semiMajorAxisAu: 0.38709843, eccentricity: 0.20563661, inclinationDeg: 7.00559432, longitudeOfAscendingNodeDeg: 48.33961819, argumentOfPeriapsisDeg: 29.118100759999997, meanAnomalyAtEpochDeg: 174.79394829, epochJd: 2451545},
  rates: {meanMotionDegPerDay: 4.092338805372484, longitudeOfAscendingNodeDegPerDay: -0.0000033440607802874744, argumentOfPeriapsisDegPerDay: 0.000007708198494182067},
  rotationalElements: {poleRaDeg: [281.0103, -0.0328, 0], poleDecDeg: [61.4155, -0.0049, 0], primeMeridianDeg: [329.5988, 6.1385108, 0]}
};
const BODIES = [EARTH, SATURN, ERIS, HYPERION, MERCURY];
// An exoplanet round the Sun's record, which is all the page needs of its host.
const EXOPLANET: ExoplanetRecord = { id: 'x b', hostStarId: 0, hostStarName: 'Sol', name: 'X b', orbit: { semiMajorAxisAu: 0.05 } };

/** Stands in for the WebGPU engine: a scene, a camera, and the tick hook, driven by hand. */
class FakeEngineService {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private readonly callbacks = new Set<EngineTickCallback>();

  async init(): Promise<void> {}
  getScene(): THREE.Scene {
    return this.scene;
  }
  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }
  onTick(callback: EngineTickCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
  start(): void {}
  resize(): void {}
  dispose(): void {}
  tick(deltaSeconds: number): void {
    for (const callback of this.callbacks) {
      callback(deltaSeconds, 0);
    }
  }
}

class FakeDataLoaderService {
  loadStars(): Promise<StarField> {
    return Promise.resolve({ stars: [SUN], positions: new Float32Array([0, 0, 0]) });
  }
  loadBodies(): Promise<BodyRecord[]> {
    return Promise.resolve(BODIES);
  }
  loadExoplanets(): Promise<ExoplanetRecord[]> {
    return Promise.resolve([EXOPLANET]);
  }
}

async function flushAsync(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('BodyDetailSceneComponent', () => {
  let engine: FakeEngineService;
  let page: { planet: THREE.Mesh; ring?: THREE.Mesh; sunLight: THREE.DirectionalLight };
  let time: TimeStore;
  let route: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  let fixture: ComponentFixture<BodyDetailSceneComponent>;

  /** Opens a body's page at a date; `whole` keeps the page's own template, dock and panel included. */
  async function open(id: string, date = '2025-06-01T12:00Z', whole = false): Promise<void> {
    engine = new FakeEngineService();
    route = new BehaviorSubject(convertToParamMap({ id }));
    TestBed.configureTestingModule({
      imports: [BodyDetailSceneComponent],
      providers: [
        { provide: DataLoaderService, useClass: FakeDataLoaderService },
        { provide: ActivatedRoute, useValue: { paramMap: route } },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } }
      ]
    }).overrideComponent(BodyDetailSceneComponent, {
      // The scene alone, unless asked: the info panel and the dock are tested on their own.
      set: whole ? { providers: [{ provide: EngineService, useValue: engine }] } : { providers: [{ provide: EngineService, useValue: engine }], imports: [], template: '<canvas #canvas></canvas>' }
    });
    time = TestBed.inject(TimeStore);
    time.setRate(0);
    time.setDate(new Date(date));
    fixture = TestBed.createComponent(BodyDetailSceneComponent);
    fixture.detectChanges();
    await flushAsync();
    page = fixture.componentInstance as unknown as typeof page;
    engine.tick(0.016);
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('lays Saturn’s rings in its equator on the page, where audit #47 found them 17 degrees off it', async () => {
    await open('saturn');
    const ring = page.ring!;
    ring.updateWorldMatrix(true, false);
    const normal = new THREE.Vector3().fromBufferAttribute(ring.geometry.attributes['normal'], 0).transformDirection(ring.matrixWorld);
    const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(page.planet.quaternion);
    expect(normal.angleTo(pole)).toBeLessThan(1e-6);
  });

  it('turns Earth on its page as it stands at the map’s date, under its real Sun', async () => {
    await open('earth');
    const planet = new THREE.Quaternion();
    const sun = new THREE.Vector3();
    expect(bodyPageView(EARTH, BODIES, time.julianDate(), Math.atan2(4, 5), planet, sun)).toBe(true);
    expect(page.planet.quaternion.angleTo(planet)).toBeLessThan(1e-9);
    expect(page.sunLight.position.clone().normalize().angleTo(sun)).toBeLessThan(1e-9);
  });

  it('follows the clock once the page is open, as it runs or is set', async () => {
    await open('earth');
    time.setDate(new Date('2025-06-01T18:00Z'));
    engine.tick(0.016);
    const planet = new THREE.Quaternion();
    expect(bodyPageView(EARTH, BODIES, time.julianDate(), Math.atan2(4, 5), planet, new THREE.Vector3())).toBe(true);
    // Six hours on, a quarter turn of Earth: a page frozen at its first frame is 90 degrees out.
    expect(page.planet.quaternion.angleTo(planet)).toBeLessThan(1e-9);
  });

  it('puts the page’s own light back when the next body shown has no IAU model to place its Sun', async () => {
    await open('earth');
    expect(page.sunLight.position.distanceTo(new THREE.Vector3(4, 3, 5))).toBeGreaterThan(0.1);
    route.next(convertToParamMap({ id: 'eris' }));
    await flushAsync();
    engine.tick(0.016);
    expect(page.sunLight.position.distanceTo(new THREE.Vector3(4, 3, 5))).toBeLessThan(1e-9);
  });

  it('puts the sphere back at rest when the next body shown does not turn: Hyperion after Earth', async () => {
    await open('earth');
    expect(page.planet.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1);
    route.next(convertToParamMap({ id: 'hyperion' }));
    await flushAsync();
    engine.tick(0.016);
    engine.tick(0.016);
    expect(page.planet.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });

  it('turns a body whose day is measured but not its pole at that day on the map’s clock: Eris a sixth of a turn in 63.084 hours', async () => {
    await open('eris');
    const start = page.planet.rotation.y;
    // The clock stands (the page is opened at rate 0): so does Eris, where it used to turn for show.
    engine.tick(1);
    expect(page.planet.rotation.y).toBe(start);
    time.setDate(new Date(Date.parse('2025-06-01T12:00Z') + (378.504 / 6) * 3600000));
    engine.tick(0.016);
    const turned = (((page.planet.rotation.y - start) / (2 * Math.PI)) % 1 + 1) % 1;
    expect(turned).toBeCloseTo(1 / 6, 6);
    // Pole up, as the system view turns it about its orbit's normal.
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(page.planet.quaternion).y).toBeCloseTo(1, 12);
  });

  it('turns an exoplanet slowly for show, clock or no clock: the catalogue carries no day for it', async () => {
    await open('x b');
    const start = page.planet.rotation.y;
    // The clock stands; a second of the page's own time is 0.08 radians.
    engine.tick(1);
    expect(page.planet.rotation.y - start).toBeCloseTo(0.08, 12);
  });

  it('says on its dock the date the body is drawn for, and nothing at the present, and offers the clock', async () => {
    await open('saturn', '2032-06-01T12:00Z', true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="hud-date"]')?.textContent).toContain('2032-06-01');
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())).toContain('Clock');
    time.reset();
    engine.tick(0.016);
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="hud-date"]')).toBeNull();
  });

  it('opens Saturn on the face of its rings the Sun lights: the south, from 2025 to 2039', async () => {
    await open('saturn', '2032-06-01T12:00Z');
    const camera = engine.getCamera();
    // The Sun 26.7 degrees south of the rings, and the camera with it rather than 11 degrees north.
    expect(page.sunLight.position.y).toBeLessThan(0);
    expect(camera.position.y).toBeLessThan(0);

    route.next(convertToParamMap({ id: 'earth' }));
    await flushAsync();
    engine.tick(0.016);
    // June: Earth's Sun is in the north, and so is the camera again.
    expect(page.sunLight.position.y).toBeGreaterThan(0);
    expect(camera.position.y).toBeGreaterThan(0);
  });

  it('follows the Sun across Saturn’s equator when the clock is set past the 2039 equinox, and aims at Saturn in that same frame', async () => {
    await open('saturn', '2032-06-01T12:00Z');
    const camera = engine.getCamera();
    expect(camera.position.y).toBeLessThan(0);
    // What the page's own Clock tab does: 2045, the Sun 25.7 degrees north of the rings.
    time.setDate(new Date('2045-06-01T12:00Z'));
    engine.tick(0.016);
    expect(page.sunLight.position.y).toBeGreaterThan(0);
    expect(camera.position.y).toBeGreaterThan(0);
    // The frame drawn straight after the move: aimed from where the camera was, it had Saturn 22.6
    // degrees off the middle of the view.
    const toSaturn = new THREE.Vector3().sub(camera.position);
    expect(camera.getWorldDirection(new THREE.Vector3()).angleTo(toSaturn)).toBeLessThan(1e-9);
  });

  it('opens the next body shown on its own Sun’s side, wherever the reader left the camera: Earth after Saturn in December', async () => {
    await open('saturn', '2032-12-01T12:00Z');
    const camera = engine.getCamera();
    expect(camera.position.y).toBeLessThan(0);
    // Taken north by the reader, over Saturn's unlit ring face.
    camera.position.y = 0.6;
    engine.tick(0.016);
    expect(camera.position.y).toBeGreaterThan(0);

    route.next(convertToParamMap({ id: 'earth' }));
    await flushAsync();
    engine.tick(0.016);
    // December: Earth's Sun is south, as Saturn's was, so only the side chosen afresh moves the camera.
    expect(page.sunLight.position.y).toBeLessThan(0);
    expect(camera.position.y).toBeLessThan(0);
  });

  it('leaves the camera on its side while the Sun only grazes the equator: Mercury through two crossings', async () => {
    // The Sun is south of Mercury's equator on 2026-10-20, north from about 1 November, and south
    // again from about 6 December, never more than 0.034 degrees either side.
    await open('mercury', '2026-10-20T00:00Z');
    const camera = engine.getCamera();
    expect(page.sunLight.position.y).toBeLessThan(0);
    expect(camera.position.y).toBeLessThan(0);
    const sunSides = new Set<number>();
    for (let day = 1; day <= 60; day++) {
      time.setDate(new Date(Date.parse('2026-10-20T00:00Z') + day * 86400000));
      engine.tick(0.016);
      sunSides.add(Math.sign(page.sunLight.position.y));
      expect(camera.position.y).toBeLessThan(0);
    }
    expect([...sunSides].sort()).toEqual([-1, 1]);
  });

  it('leaves the camera where the reader orbits it while the Sun stays on one side', async () => {
    await open('saturn', '2032-06-01T12:00Z');
    const camera = engine.getCamera();
    // Taken over the rings, to their unlit face, on purpose.
    camera.position.y = 0.6;
    engine.tick(0.016);
    expect(camera.position.y).toBeGreaterThan(0);
  });
});
