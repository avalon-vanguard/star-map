import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { DeepSkyRecord } from '../../shared/models/deepsky.model';
import { backdropPosition, backdropSpriteSizePc, BACKDROP_RADIUS_PC, brightnessBandIndex, deepSkyLabelPoints, DeepSkyRenderer } from './deep-sky-renderer';

function record(overrides: Partial<DeepSkyRecord> = {}): DeepSkyRecord {
  return {
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
    ...overrides
  };
}

describe('backdropPosition', () => {
  it('pushes the direction out to the shell radius', () => {
    const position = backdropPosition(record({ x: 0, y: 0, z: 1 }));
    expect(position.z).toBeCloseTo(BACKDROP_RADIUS_PC, 9);
    expect(position.length()).toBeCloseTo(BACKDROP_RADIUS_PC, 9);
  });

  it('preserves direction for an off-axis object', () => {
    const direction = new THREE.Vector3(0.3, -0.5, 0.81).normalize();
    const position = backdropPosition(record({ x: direction.x, y: direction.y, z: direction.z }));

    expect(position.length()).toBeCloseTo(BACKDROP_RADIUS_PC, 6);
    expect(position.clone().normalize().dot(direction)).toBeCloseTo(1, 9);
  });

  it('honours an explicit radius', () => {
    expect(backdropPosition(record(), 100).length()).toBeCloseTo(100, 9);
  });

  it('lands inside the galaxy camera frustum from anywhere on its orbit', () => {
    // The camera orbits at most 2000 pc out and its far plane is 5000 pc, so the far side of
    // the shell has to stay within reach or the backdrop would be clipped away.
    expect(BACKDROP_RADIUS_PC).toBeGreaterThan(2000);
    expect(BACKDROP_RADIUS_PC + 2000).toBeLessThan(5000);
  });
});

describe('backdropSpriteSizePc', () => {
  it('scales with true angular size', () => {
    const small = backdropSpriteSizePc(record({ angularSizeDeg: 1 }));
    const large = backdropSpriteSizePc(record({ angularSizeDeg: 2 }));
    expect(large).toBeGreaterThan(small);
  });

  it('reproduces the real angular size in the unclamped range', () => {
    // 2 degrees at the shell radius: r * theta.
    const expected = BACKDROP_RADIUS_PC * 2 * (Math.PI / 180);
    expect(backdropSpriteSizePc(record({ angularSizeDeg: 2 }))).toBeCloseTo(expected, 6);
  });

  it('floors sub-arcminute objects so they stay visible', () => {
    const tiny = backdropSpriteSizePc(record({ angularSizeDeg: 0 }));
    expect(tiny).toBeGreaterThan(0);
    expect(tiny).toBe(backdropSpriteSizePc(record({ angularSizeDeg: 0.001 })));
  });

  it('caps very extended objects so they cannot blanket the view', () => {
    const huge = backdropSpriteSizePc(record({ angularSizeDeg: 90 }));
    const larger = backdropSpriteSizePc(record({ angularSizeDeg: 180 }));
    expect(huge).toBe(larger);
  });
});

describe('brightnessBandIndex', () => {
  it('puts the brightest objects in the most opaque band', () => {
    expect(brightnessBandIndex(3.44)).toBe(0);
  });

  it('separates mid and faint objects into later bands', () => {
    expect(brightnessBandIndex(6)).toBe(1);
    expect(brightnessBandIndex(9)).toBe(2);
  });

  it('is monotonic in magnitude', () => {
    const bands = [0, 3, 5, 6, 7.5, 9, 14].map(brightnessBandIndex);
    expect([...bands].sort((a, b) => a - b)).toEqual(bands);
  });

  it('treats an unphotometered object as faintest rather than brightest', () => {
    expect(brightnessBandIndex(null)).toBe(brightnessBandIndex(99));
  });
});

describe('deepSkyLabelPoints', () => {
  const records = [record({ id: 'a', name: 'A' }), record({ id: 'b', name: 'B' }), record({ id: 'c', name: 'C' })];

  it('takes a prefix of the (magnitude-sorted) records', () => {
    expect(deepSkyLabelPoints(records, 2).map((point) => point.id)).toEqual(['a', 'b']);
  });

  it('anchors each label on the backdrop shell', () => {
    const [point] = deepSkyLabelPoints(records, 1);
    expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(BACKDROP_RADIUS_PC, 6);
  });

  it('carries the display name and the catalog id', () => {
    const [point] = deepSkyLabelPoints(records, 1);
    expect(point).toMatchObject({ id: 'a', name: 'A' });
  });

  it('never returns more labels than there are records', () => {
    expect(deepSkyLabelPoints(records, 99)).toHaveLength(3);
    expect(deepSkyLabelPoints([], 5)).toEqual([]);
  });
});

describe('DeepSkyRenderer', () => {
  it('adds one sprite per record', () => {
    const renderer = new DeepSkyRenderer([record({ id: 'a' }), record({ id: 'b' })]);
    expect(renderer.object.children).toHaveLength(2);
    expect(renderer.object.children.every((child) => child instanceof THREE.Sprite)).toBe(true);
    renderer.dispose();
  });

  it('positions and scales each sprite from its record', () => {
    const only = record({ angularSizeDeg: 2 });
    const renderer = new DeepSkyRenderer([only]);
    const sprite = renderer.object.children[0] as THREE.Sprite;

    expect(sprite.position.length()).toBeCloseTo(BACKDROP_RADIUS_PC, 6);
    expect(sprite.scale.x).toBeCloseTo(backdropSpriteSizePc(only), 6);
    renderer.dispose();
  });

  it('shares one material across objects of the same kind and brightness', () => {
    const renderer = new DeepSkyRenderer([
      record({ id: 'a', kind: 'galaxy', magnitude: 3 }),
      record({ id: 'b', kind: 'galaxy', magnitude: 4 })
    ]);
    const [first, second] = renderer.object.children as THREE.Sprite[];

    expect(first.material).toBe(second.material);
    renderer.dispose();
  });

  it('gives different kinds different materials', () => {
    const renderer = new DeepSkyRenderer([
      record({ id: 'a', kind: 'galaxy', magnitude: 3 }),
      record({ id: 'b', kind: 'nebula', magnitude: 3 }),
      record({ id: 'c', kind: 'cluster', magnitude: 3 })
    ]);
    const materials = new Set((renderer.object.children as THREE.Sprite[]).map((sprite) => sprite.material));

    expect(materials.size).toBe(3);
    renderer.dispose();
  });

  it('gives different brightness bands different materials', () => {
    const renderer = new DeepSkyRenderer([
      record({ id: 'a', kind: 'galaxy', magnitude: 3 }),
      record({ id: 'b', kind: 'galaxy', magnitude: 9 })
    ]);
    const [bright, faint] = renderer.object.children as THREE.Sprite[];

    expect(bright.material).not.toBe(faint.material);
    expect(bright.material.opacity).toBeGreaterThan(faint.material.opacity);
    renderer.dispose();
  });

  it('keeps the material count bounded no matter how many objects there are', () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      record({ id: `obj-${index}`, kind: (['galaxy', 'nebula', 'cluster'] as const)[index % 3], magnitude: index % 12 })
    );
    const renderer = new DeepSkyRenderer(many);
    const materials = new Set((renderer.object.children as THREE.Sprite[]).map((sprite) => sprite.material));

    expect(renderer.object.children).toHaveLength(200);
    // Three kinds x three brightness bands.
    expect(materials.size).toBeLessThanOrEqual(9);
    renderer.dispose();
  });

  it('renders behind the star field', () => {
    const renderer = new DeepSkyRenderer([record()]);
    expect(renderer.object.renderOrder).toBeLessThan(0);
    renderer.dispose();
  });

  it('disposes its materials and empties the group', () => {
    const renderer = new DeepSkyRenderer([record({ id: 'a' }), record({ id: 'b', kind: 'nebula' })]);
    const materials = (renderer.object.children as THREE.Sprite[]).map((sprite) => sprite.material);
    const disposed = materials.map((material) => {
      let seen = false;
      material.addEventListener('dispose', () => (seen = true));
      return () => seen;
    });

    renderer.dispose();

    expect(renderer.object.children).toHaveLength(0);
    expect(disposed.every((wasDisposed) => wasDisposed())).toBe(true);
  });

  it('handles an empty catalog', () => {
    const renderer = new DeepSkyRenderer([]);
    expect(renderer.object.children).toHaveLength(0);
    expect(renderer.labelPoints(5)).toEqual([]);
    renderer.dispose();
  });
});
