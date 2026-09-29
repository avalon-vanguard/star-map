import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { StarRecord } from '../../shared/models/star.model';
import { colorIndexToRgb, magnitudeToPointSize, selectDrawnStars, StarFieldRenderer } from './star-field-renderer';

function star(overrides: Partial<StarRecord> = {}): StarRecord {
  return {
    id: 1,
    name: 'Test Star',
    x: 0,
    y: 0,
    z: 0,
    magnitude: 5,
    spectralType: 'G2V',
    colorIndex: 0.65,
    ...overrides
  };
}

function packPositions(stars: readonly StarRecord[]): Float32Array {
  return new Float32Array(stars.flatMap((s) => [s.x, s.y, s.z]));
}

/** A camera looking down -Z from the origin, framing everything in front of it. */
function testCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 5000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

describe('colorIndexToRgb', () => {
  it('tints a hot, low-index star blue-white', () => {
    const color = colorIndexToRgb(-0.3);
    expect(color.b).toBeGreaterThan(color.r);
  });

  it('tints a cool, high-index star orange-red', () => {
    const color = colorIndexToRgb(1.8);
    expect(color.r).toBeGreaterThan(color.b);
  });

  it('moves monotonically from blue toward red as the index rises', () => {
    const blueness = [-0.3, 0.2, 0.65, 1.2, 1.9].map((index) => {
      const color = colorIndexToRgb(index);
      return color.b - color.r;
    });
    expect([...blueness].sort((a, b) => b - a)).toEqual(blueness);
  });

  describe('when the catalog has no photometry', () => {
    // ~10% of nearby HYG stars have a blank colour-index cell. Reading that as 0 (which is a
    // real index, meaning a hot A-type star) painted several hundred red dwarfs blue-white.
    it('falls back to the spectral type rather than to zero', () => {
      const fromNull = colorIndexToRgb(null, 'M4');
      const asIfZero = colorIndexToRgb(0);

      expect(fromNull.r).toBeGreaterThan(fromNull.b);
      expect(asIfZero.b).toBeGreaterThan(asIfZero.r);
    });

    it('matches the colour the same spectral type would give explicitly', () => {
      // K5 sits halfway between the K anchor (0.81) and the M anchor (1.40).
      const derived = colorIndexToRgb(null, 'K5');
      const explicit = colorIndexToRgb(1.105);

      expect(derived.r).toBeCloseTo(explicit.r, 6);
      expect(derived.g).toBeCloseTo(explicit.g, 6);
      expect(derived.b).toBeCloseTo(explicit.b, 6);
    });

    it('handles the bare lowercase classes HYG ships', () => {
      const color = colorIndexToRgb(null, 'm');
      expect(color.r).toBeGreaterThan(color.b);
    });

    it('falls back to neutral when the star is unclassified too', () => {
      const color = colorIndexToRgb(null, 'Unknown');
      expect(color.r).toBeCloseTo(1, 6);
      expect(color.g).toBeCloseTo(1, 6);
      expect(color.b).toBeCloseTo(1, 6);
    });
  });

  it('prefers a measured index over the spectral type', () => {
    const measured = colorIndexToRgb(-0.3, 'M5');
    expect(measured.b).toBeGreaterThan(measured.r);
  });
});

describe('magnitudeToPointSize', () => {
  it('renders brighter stars larger', () => {
    expect(magnitudeToPointSize(-1)).toBeGreaterThan(magnitudeToPointSize(12));
  });

  it('clamps outside the magnitude range rather than running away', () => {
    expect(magnitudeToPointSize(-30)).toBe(magnitudeToPointSize(-2));
    expect(magnitudeToPointSize(50)).toBe(magnitudeToPointSize(10));
  });
});

describe('StarFieldRenderer', () => {
  const stars = [star({ id: 10, name: 'A' }), star({ id: 20, name: 'B', colorIndex: null, spectralType: 'M4' })];

  it('draws one instance per star from a single shared quad', () => {
    const renderer = new StarFieldRenderer(stars, packPositions(stars));
    const geometry = renderer.object.geometry as THREE.InstancedBufferGeometry;

    expect(geometry.instanceCount).toBe(2);
    // Four corners of one quad, reused by every instance.
    expect(geometry.getAttribute('position').count).toBe(4);
    renderer.dispose();
  });

  it('never culls itself, since its geometry sits at the origin', () => {
    // The quad's bounds say nothing about where the instances are, so culling would drop the
    // entire field whenever the origin left the frustum.
    const renderer = new StarFieldRenderer(stars, packPositions(stars));
    expect(renderer.object.frustumCulled).toBe(false);
    renderer.dispose();
  });

  it('maps an instance index back to its HYG star id', () => {
    const renderer = new StarFieldRenderer(stars, packPositions(stars));

    expect(renderer.starIdAt(0)).toBe(10);
    expect(renderer.starIdAt(1)).toBe(20);
    expect(renderer.starIdAt(99)).toBeUndefined();
    renderer.dispose();
  });

  it('handles an empty star field', () => {
    const renderer = new StarFieldRenderer([], new Float32Array(0));

    expect((renderer.object.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
    expect(renderer.starIdAt(0)).toBeUndefined();
    renderer.dispose();
  });

  describe('pickAt', () => {
    const camera = testCamera();
    // Two stars straight ahead, one well off to the side.
    const picked = [
      star({ id: 1, name: 'Near', x: 0, y: 0, z: -10, magnitude: 1 }),
      star({ id: 2, name: 'Far', x: 0, y: 0, z: -100, magnitude: 1 }),
      star({ id: 3, name: 'Aside', x: 40, y: 0, z: -10, magnitude: 1 })
    ];

    it('finds the star under the pointer', () => {
      const renderer = new StarFieldRenderer(picked, packPositions(picked));
      // Both Near and Far project to the screen centre; either is a correct hit.
      expect([1, 2]).toContain(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect));
      renderer.dispose();
    });

    it('returns undefined when the pointer is on empty sky', () => {
      const renderer = new StarFieldRenderer(picked, packPositions(picked));
      expect(renderer.pickAt(new THREE.Vector2(-0.9, 0.9), camera, camera.aspect)).toBeUndefined();
      renderer.dispose();
    });

    it('ignores stars behind the camera', () => {
      // `project()` mirrors points behind the camera back onto the screen, so without an
      // explicit depth guard this star would be pickable at the centre of the view.
      const behind = [star({ id: 7, x: 0, y: 0, z: 10 })];
      const renderer = new StarFieldRenderer(behind, packPositions(behind));

      expect(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect)).toBeUndefined();
      renderer.dispose();
    });

    it('ignores a star just outside the frame, however close the pointer gets to the edge', () => {
      // Its hit area is the drawn size plus a slop, so near an edge that area reaches past the
      // frame — and a system nobody can see is not one a click should fly into.
      const offScreen = [star({ id: 9, x: 0, y: 0, z: -10, magnitude: -2 })];
      const renderer = new StarFieldRenderer(offScreen, packPositions(offScreen));
      const centre = new THREE.Vector3(0, 0, -10).project(camera);
      expect(renderer.pickAt(new THREE.Vector2(centre.x, centre.y), camera, camera.aspect)).toBe(9);

      // The same star, just outside the top of the frame: its centre at NDC 1.01, its disc ending at
      // 1.0033. A click at 0.995 is within its hit radius (0.0167) — so without the frame test this
      // picks it — while none of the star is on screen.
      const above = [star({ id: 9, x: 0, y: 10 * Math.tan((camera.fov * Math.PI) / 360) * 1.01, z: -10, magnitude: -2 })];
      const outside = new StarFieldRenderer(above, packPositions(above));

      expect(outside.pickAt(new THREE.Vector2(0, 0.995), camera, camera.aspect)).toBeUndefined();
      renderer.dispose();
      outside.dispose();
    });

    it('picks the star nearest the pointer when several are in view', () => {
      const spread = [
        star({ id: 1, x: 0, y: 0, z: -10 }),
        star({ id: 2, x: 0, y: 2, z: -10 }),
        star({ id: 3, x: 0, y: -2, z: -10 })
      ];
      const renderer = new StarFieldRenderer(spread, packPositions(spread));

      // Aim at where star 2 projects, and confirm we get it rather than its neighbours.
      const target = new THREE.Vector3(0, 2, -10).project(camera);
      expect(renderer.pickAt(new THREE.Vector2(target.x, target.y), camera, camera.aspect)).toBe(2);
      renderer.dispose();
    });

    it('gives a brighter star a larger hit area than a faint one', () => {
      const bright = [star({ id: 1, x: 0, y: 0, z: -10, magnitude: -1 })];
      const faint = [star({ id: 2, x: 0, y: 0, z: -10, magnitude: 14 })];
      const brightRenderer = new StarFieldRenderer(bright, packPositions(bright));
      const faintRenderer = new StarFieldRenderer(faint, packPositions(faint));

      // Walk outward from the centre until each stops being pickable.
      const reach = (renderer: StarFieldRenderer): number => {
        let offset = 0;
        while (offset < 1 && renderer.pickAt(new THREE.Vector2(0, offset), camera, camera.aspect) !== undefined) {
          offset += 0.001;
        }
        return offset;
      };

      expect(reach(brightRenderer)).toBeGreaterThan(reach(faintRenderer));
      brightRenderer.dispose();
      faintRenderer.dispose();
    });

    it('keeps even the faintest star clickable', () => {
      // A magnitude-15 star is drawn under 2 px across, so without the added slop the faint end
      // of the catalogue would demand sub-pixel accuracy.
      const faint = [star({ id: 5, x: 0, y: 0, z: -10, magnitude: 15 })];
      const renderer = new StarFieldRenderer(faint, packPositions(faint));

      expect(renderer.pickAt(new THREE.Vector2(0, 0.005), camera, camera.aspect)).toBe(5);
      renderer.dispose();
    });

    it('finds nothing in an empty field', () => {
      const renderer = new StarFieldRenderer([], new Float32Array(0));
      expect(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect)).toBeUndefined();
      renderer.dispose();
    });
  });
});

/** A star at a given distance along +X, with a given apparent magnitude. */
function catalogueStar(id: number, distancePc: number, magnitude: number): StarRecord {
  return { id, name: `star-${id}`, x: distancePc, y: 0, z: 0, magnitude, spectralType: 'G2V', colorIndex: 0.6 };
}

describe('selectDrawnStars', () => {
  it('draws everything when the catalogue fits the budget', () => {
    const catalogue = [catalogueStar(1, 10, 5), catalogueStar(2, 20, 6)];
    expect(Array.from(selectDrawnStars(catalogue, 10))).toEqual([0, 1]);
  });

  it('never draws more than the budget', () => {
    const catalogue = Array.from({ length: 500 }, (_, i) => catalogueStar(i, 200, i));
    expect(selectDrawnStars(catalogue, 50)).toHaveLength(50);
  });

  it('keeps the whole solar neighbourhood, however faint', () => {
    // The load-bearing case: the nearest stars are overwhelmingly faint red dwarfs, and Proxima
    // Centauri is magnitude 11. A pure brightness cut would delete the part of the map that
    // matters most and holds the nearby planets.
    const proxima = catalogueStar(999, 1.3, 11.1);
    const catalogue = [proxima, ...Array.from({ length: 200 }, (_, i) => catalogueStar(i, 240, 2))];
    const drawn = selectDrawnStars(catalogue, 20);

    expect(Array.from(drawn)).toContain(0);
    expect(drawn).toHaveLength(20);
  });

  it('spends what is left on the brightest stars beyond the neighbourhood', () => {
    const catalogue = [catalogueStar(0, 10, 12), catalogueStar(1, 200, 8), catalogueStar(2, 200, 2), catalogueStar(3, 200, 5)];
    const drawn = Array.from(selectDrawnStars(catalogue, 3));

    // The nearby faint one, then the two brightest distant ones — not the magnitude-8 straggler.
    expect(drawn).toEqual([0, 2, 3]);
  });

});

describe('StarFieldRenderer render budget', () => {
  it('draws only the budget, and reports how many that was', () => {
    const catalogue = Array.from({ length: 300 }, (_, i) => catalogueStar(i, 200, i));
    const positions = new Float32Array(catalogue.flatMap((s) => [s.x, s.y, s.z]));
    const renderer = new StarFieldRenderer(catalogue, positions, 40);

    expect(renderer.drawnCount).toBe(40);
    expect((renderer.object.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(40);
    renderer.dispose();
  });

  it('keeps each drawn star with its own position after subsetting', () => {
    // The subtle failure this guards: repacking positions for a subset while the colours and
    // sizes follow a different order would give every star someone else's place in the sky.
    const catalogue = [catalogueStar(0, 5, 9), catalogueStar(1, 200, 1), catalogueStar(2, 200, 7)];
    const positions = new Float32Array(catalogue.flatMap((s) => [s.x, s.y, s.z]));
    const renderer = new StarFieldRenderer(catalogue, positions, 2);

    expect(renderer.drawnCount).toBe(2);
    expect(renderer.starIdAt(0)).toBe(0);
    expect(renderer.starIdAt(1)).toBe(1);
    renderer.dispose();
  });
});

describe('selectDrawnStars around the view', () => {
  /** 200 bright stars 240 pc out, enough to spend any small budget on their own. */
  const brightFar = (from: number) => Array.from({ length: 200 }, (_, i) => catalogueStar(from + i, 240, 2));

  it('draws a faint star near where the view is centred, however far that is from the Sun', () => {
    const faint = catalogueStar(0, 150, 12);
    const catalogue = [faint, ...brightFar(1)];

    expect(Array.from(selectDrawnStars(catalogue, 20))).not.toContain(0);
    expect(Array.from(selectDrawnStars(catalogue, 20, { centre: { x: 150, y: 0, z: 0 } }))).toContain(0);
  });

  it("keeps the Sun's neighbourhood drawn while the view looks elsewhere", () => {
    const catalogue = [catalogueStar(0, 1.3, 11), catalogueStar(1, 150, 13), ...brightFar(2)];

    expect(Array.from(selectDrawnStars(catalogue, 20, { centre: { x: 150, y: 0, z: 0 } })).slice(0, 2)).toEqual([1, 0]);
  });

  it('draws a pinned star wherever it is and however faint', () => {
    const catalogue = [catalogueStar(0, 240, 14), ...brightFar(1)];

    expect(Array.from(selectDrawnStars(catalogue, 20))).not.toContain(0);
    expect(Array.from(selectDrawnStars(catalogue, 20, { pinned: [0] }))).toContain(0);
  });

  it('spends a budget too small for everything on the pinned stars, then the view, then the Sun, then the brightest', () => {
    const catalogue = [catalogueStar(0, 1, 12), catalogueStar(1, 150, 13), catalogueStar(2, 240, 14), ...brightFar(3)];
    const focus = { centre: { x: 150, y: 0, z: 0 }, pinned: [2] };

    expect(Array.from(selectDrawnStars(catalogue, 4, focus))).toEqual([2, 1, 0, 3]);
    expect(Array.from(selectDrawnStars(catalogue, 2, focus))).toEqual([2, 1]);
  });

  it('keeps the brightest part of a neighbourhood the budget cannot hold whole', () => {
    const catalogue = [catalogueStar(0, 150, 9), catalogueStar(1, 151, 4), catalogueStar(2, 152, 11), catalogueStar(3, 153, 6), ...brightFar(4)];

    expect(Array.from(selectDrawnStars(catalogue, 2, { centre: { x: 150, y: 0, z: 0 } }))).toEqual([1, 3]);
  });

  it('draws nothing twice when the view is centred on the Sun or pins a star already near it', () => {
    const catalogue = [catalogueStar(0, 1, 12), catalogueStar(1, 2, 13), ...brightFar(2)];
    const drawn = Array.from(selectDrawnStars(catalogue, 10, { centre: { x: 0, y: 0, z: 0 }, pinned: [0, 0, 1] }));

    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn).toHaveLength(10);
  });
});

describe('selectDrawnStars in view', () => {
  /** A star anywhere, with a given apparent magnitude. */
  const at = (id: number, x: number, y: number, z: number, magnitude: number) => star({ id, x, y, z, magnitude });
  /** What the camera shows, as the scene hands it over. */
  const viewOf = (camera: THREE.Camera) => new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  /** Bright stars far in front of `testCamera`, spread across its frame. */
  const brightAhead = (from: number, count = 30) => Array.from({ length: count }, (_, i) => at(from + i, (i - count / 2) * 5, 0, -400, 2));
  /** Bright stars behind `testCamera`, which only a selection blind to the view would draw. */
  const brightBehind = (from: number, count = 30) => Array.from({ length: count }, (_, i) => at(from + i, (i - count / 2) * 5, 0, 400, 2));

  it('draws only what is in view, and a pinned star wherever it is', () => {
    const ahead = Array.from({ length: 5 }, (_, i) => at(i, i * 10, 0, -240, 12));
    const pinnedBehind = at(5, 0, 0, 240, 14);
    const catalogue = [...ahead, pinnedBehind, ...brightBehind(6)];

    const drawn = Array.from(selectDrawnStars(catalogue, 20, { pinned: [5], view: viewOf(testCamera()) }));

    expect(drawn).toEqual([5, 0, 1, 2, 3, 4]);
  });

  it('reaches a quarter of the frame past its edges, and no further', () => {
    // At 100 pc in front of a 55° camera the frame's half-height is 52 pc: 1.2 of it is 62.5 pc, 1.3 is 67.7.
    const halfHeight = 100 * Math.tan((55 * Math.PI) / 360);
    const catalogue = [at(0, 0, 1.2 * halfHeight, -100, 12), at(1, 0, 1.3 * halfHeight, -100, 12), ...brightBehind(2)];

    const drawn = Array.from(selectDrawnStars(catalogue, 20, { view: viewOf(testCamera()) }));

    expect(drawn).toEqual([0]);
  });

  it("draws the neighbourhood of the view's centre ahead of brighter stars, but only the part in view", () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 5000);
    camera.position.set(0, 0, -140);
    camera.lookAt(0, 0, -1000);
    camera.updateMatrixWorld(true);
    const memberAhead = at(0, 0, 0, -160, 14);
    const memberBehind = at(1, 0, 0, -130, 14);
    const catalogue = [memberAhead, memberBehind, ...Array.from({ length: 30 }, (_, i) => at(2 + i, (i - 15) * 5, 0, -600, 2))];

    const drawn = Array.from(selectDrawnStars(catalogue, 20, { centre: { x: 0, y: 0, z: -150 }, view: viewOf(camera) }));

    expect(drawn[0]).toBe(0);
    expect(drawn).not.toContain(1);
  });

  it('draws the planet hosts in view first after the pinned stars, and not those out of view', () => {
    const hostAhead = at(0, 0, 0, -240, 14);
    const hostBehind = at(1, 0, 0, 240, 14);
    const nearSun = at(2, 0, 0, -10, 13);
    const catalogue = [hostAhead, hostBehind, nearSun, ...brightAhead(3)];
    const hosts = Uint8Array.from(catalogue, (_, index) => (index < 2 ? 1 : 0));

    const drawn = Array.from(selectDrawnStars(catalogue, 3, { hosts, view: viewOf(testCamera()) }));

    expect(drawn).toEqual([0, 2, 3]);
  });

  it('frames a plan view as a box, however deep: behind the camera included', () => {
    const plan = new THREE.OrthographicCamera(-10, 10, 10, -10, -5000, 5000);
    plan.position.set(0, 0, 0);
    plan.lookAt(0, 0, -1);
    plan.updateMatrixWorld(true);
    const catalogue = [at(0, 0, 0, 50, 12), at(1, 12, 0, -50, 12), at(2, 13, 0, -50, 12), ...Array.from({ length: 30 }, (_, i) => at(3 + i, 500, i, 0, 2))];

    const drawn = Array.from(selectDrawnStars(catalogue, 20, { view: viewOf(plan) }));

    expect(drawn).toEqual([0, 1]);
  });
});

describe('StarFieldRenderer refocus', () => {
  const camera = testCamera();
  /** A faint star straight ahead, 150 pc out, among bright ones well off to the side. */
  const faintAhead = star({ id: 77, x: 0, y: 0, z: -150, magnitude: 13, colorIndex: 1.9 });
  const catalogue = [faintAhead, ...Array.from({ length: 50 }, (_, i) => star({ id: 100 + i, x: 60, y: i, z: -40, magnitude: 1, colorIndex: -0.3 + i * 0.04 }))];
  const positions = packPositions(catalogue);

  it('draws and picks a faint star once the view is centred near it', () => {
    const renderer = new StarFieldRenderer(catalogue, positions, 10);
    expect(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect)).toBeUndefined();

    renderer.refocus({ centre: { x: 0, y: 0, z: -140 } });

    expect(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect)).toBe(77);
    expect((renderer.object.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(renderer.drawnCount);
    renderer.dispose();
  });

  it('draws a pinned star, and passes over an index past the end of the catalogue', () => {
    const renderer = new StarFieldRenderer(catalogue, positions, 10);

    renderer.refocus({ pinned: [123456, 0] });

    const drawnIds = Array.from({ length: renderer.drawnCount }, (_, i) => renderer.starIdAt(i));
    expect(drawnIds).toContain(77);
    expect(renderer.drawnCount).toBe(10);
    renderer.dispose();
  });

  it('gives each drawn star its own colour and size, wherever the refocus put it', () => {
    const renderer = new StarFieldRenderer(catalogue, positions, 10);
    renderer.refocus({ centre: { x: 0, y: 0, z: -140 }, pinned: [21] });
    const { colorAttribute, sizeAttribute } = renderer as unknown as { colorAttribute: THREE.InstancedBufferAttribute; sizeAttribute: THREE.InstancedBufferAttribute };

    for (let instance = 0; instance < renderer.drawnCount; instance++) {
      const drawnStar = catalogue.find((candidate) => candidate.id === renderer.starIdAt(instance))!;
      const expected = colorIndexToRgb(drawnStar.colorIndex, drawnStar.spectralType);
      expect(colorAttribute.getX(instance)).toBeCloseTo(expected.r, 5);
      expect(colorAttribute.getZ(instance)).toBeCloseTo(expected.b, 5);
      expect(sizeAttribute.getX(instance)).toBeGreaterThan(0);
    }
    const faintSlot = Array.from({ length: renderer.drawnCount }, (_, i) => renderer.starIdAt(i)).indexOf(77);
    const brightSlot = Array.from({ length: renderer.drawnCount }, (_, i) => renderer.starIdAt(i)).indexOf(120);
    expect(sizeAttribute.getX(brightSlot)).toBeGreaterThan(sizeAttribute.getX(faintSlot));
    renderer.dispose();
  });

  it('leaves the buffers alone when the drawn set has not changed, and rewrites them when it has', () => {
    const renderer = new StarFieldRenderer(catalogue, positions, 10);
    const { positionAttribute } = renderer as unknown as { positionAttribute: THREE.InstancedBufferAttribute };
    const version = positionAttribute.version;

    renderer.refocus({ centre: { x: 0, y: 0, z: 0 } });
    expect(positionAttribute.version).toBe(version);

    renderer.refocus({ centre: { x: 0, y: 0, z: -140 } });
    expect(positionAttribute.version).toBeGreaterThan(version);
    renderer.dispose();
  });

  it('drops a star from the drawn set, and from picking, once the view has moved away from it', () => {
    // The subtle failure this guards: buffers rewritten for a new selection while picking still
    // reads the old one would leave clickable ghosts where nothing is drawn.
    const renderer = new StarFieldRenderer(catalogue, positions, 10);
    renderer.refocus({ centre: { x: 0, y: 0, z: -140 } });
    expect(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect)).toBe(77);

    renderer.refocus({ centre: { x: 0, y: 0, z: 0 } });

    expect(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect)).toBeUndefined();
    expect(Array.from({ length: renderer.drawnCount }, (_, i) => renderer.starIdAt(i))).not.toContain(77);
    renderer.dispose();
  });

  it('drops a star from the drawn set, and from picking, once the camera has turned away from it', () => {
    const renderer = new StarFieldRenderer(catalogue, positions, 10);
    const view = (from: THREE.Camera) => new THREE.Matrix4().multiplyMatrices(from.projectionMatrix, from.matrixWorldInverse);
    renderer.refocus({ centre: { x: 0, y: 0, z: -140 }, view: view(camera) });
    expect(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect)).toBe(77);

    const turned = testCamera();
    turned.lookAt(0, 0, 1);
    turned.updateMatrixWorld(true);
    renderer.refocus({ centre: { x: 0, y: 0, z: -140 }, view: view(turned) });

    expect(renderer.pickAt(new THREE.Vector2(0, 0), camera, camera.aspect)).toBeUndefined();
    expect(Array.from({ length: renderer.drawnCount }, (_, i) => renderer.starIdAt(i))).not.toContain(77);
    renderer.dispose();
  });
});
