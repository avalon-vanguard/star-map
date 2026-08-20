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

  it('returns catalogue indices in order, so positions can be subset alongside', () => {
    const catalogue = Array.from({ length: 100 }, (_, i) => catalogueStar(i, 150, 100 - i));
    const drawn = Array.from(selectDrawnStars(catalogue, 10));
    expect(drawn).toEqual([...drawn].sort((a, b) => a - b));
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
