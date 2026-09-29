import { TestBed } from '@angular/core/testing';
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
const BODIES = [EARTH, SATURN];

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
    return Promise.resolve([]);
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

  async function open(id: string): Promise<void> {
    engine = new FakeEngineService();
    TestBed.configureTestingModule({
      imports: [BodyDetailSceneComponent],
      providers: [
        { provide: DataLoaderService, useClass: FakeDataLoaderService },
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id })) } },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } }
      ]
    }).overrideComponent(BodyDetailSceneComponent, {
      // The scene alone: the info panel and the dock are tested on their own.
      set: { providers: [{ provide: EngineService, useValue: engine }], imports: [], template: '<canvas #canvas></canvas>' }
    });
    time = TestBed.inject(TimeStore);
    time.setRate(0);
    time.setDate(new Date('2025-06-01T12:00Z'));
    const fixture = TestBed.createComponent(BodyDetailSceneComponent);
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
});
