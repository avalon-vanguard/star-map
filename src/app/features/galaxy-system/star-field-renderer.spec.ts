import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { StarRecord } from '../../shared/models/star.model';
import { colorIndexToRgb, magnitudeToPointSize, StarFieldRenderer } from './star-field-renderer';

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
      expect([1, 2]).toContain(renderer.pickAt(new THREE.Vector2(0, 0), camera));
      renderer.dispose();
    });

    it('returns undefined when the pointer is on empty sky', () => {
      const renderer = new StarFieldRenderer(picked, packPositions(picked));
      expect(renderer.pickAt(new THREE.Vector2(-0.9, 0.9), camera)).toBeUndefined();
      renderer.dispose();
    });

    it('ignores stars behind the camera', () => {
      // `project()` mirrors points behind the camera back onto the screen, so without an
      // explicit depth guard this star would be pickable at the centre of the view.
      const behind = [star({ id: 7, x: 0, y: 0, z: 10 })];
      const renderer = new StarFieldRenderer(behind, packPositions(behind));

      expect(renderer.pickAt(new THREE.Vector2(0, 0), camera)).toBeUndefined();
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
      expect(renderer.pickAt(new THREE.Vector2(target.x, target.y), camera)).toBe(2);
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
        while (offset < 1 && renderer.pickAt(new THREE.Vector2(0, offset), camera) !== undefined) {
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

      expect(renderer.pickAt(new THREE.Vector2(0, 0.005), camera)).toBe(5);
      renderer.dispose();
    });

    it('finds nothing in an empty field', () => {
      const renderer = new StarFieldRenderer([], new Float32Array(0));
      expect(renderer.pickAt(new THREE.Vector2(0, 0), camera)).toBeUndefined();
      renderer.dispose();
    });
  });
});
