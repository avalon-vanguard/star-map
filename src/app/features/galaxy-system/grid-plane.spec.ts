import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { galacticCentrePositionPc, SUN_HEIGHT_ABOVE_MIDPLANE_PC } from '../../shared/astro/galaxy';
import { galacticFrameQuaternion, galacticNormal, PolarGridPlane, TetherField } from './grid-plane';

const SEGMENTS_PER_RING = 180;

function vertexAt(geometry: THREE.BufferGeometry, index: number): THREE.Vector3 {
  const position = geometry.getAttribute('position');
  return new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
}

describe('galacticFrameQuaternion', () => {
  it('carries the local +Z onto the galactic normal, so a flat grid lands in the galactic plane', () => {
    const rotated = new THREE.Vector3(0, 0, 1).applyQuaternion(galacticFrameQuaternion());
    const normal = galacticNormal();
    expect(rotated.x).toBeCloseTo(normal.x, 9);
    expect(rotated.y).toBeCloseTo(normal.y, 9);
    expect(rotated.z).toBeCloseTo(normal.z, 9);
  });

  it('tilts that plane the real angle away from the celestial equator', () => {
    // The galactic and celestial poles are 62.9 degrees apart, so the planes are too.
    const normal = galacticNormal();
    expect((Math.acos(Math.abs(normal.z)) * 180) / Math.PI).toBeCloseTo(62.87, 1);
  });
});

describe('PolarGridPlane', () => {
  const rings = [10, 20, 50];
  const spokes = 8;
  const grid = new PolarGridPlane({ ringRadiiPc: rings, spokeCount: spokes, emphasisRadiiPc: [50] });

  it('draws every ring segment and every spoke', () => {
    expect(grid.object.geometry.getAttribute('position').count).toBe(rings.length * SEGMENTS_PER_RING * 2 + spokes * 2);
  });

  it('starts hidden, so a view that never zooms out never draws it', () => {
    expect(grid.object.visible).toBe(false);
  });

  it('fades in and out with strength, and disappears outright at zero', () => {
    grid.setStrength(1);
    expect(grid.object.visible).toBe(true);
    const full = (grid.object.material as THREE.LineBasicMaterial).opacity;

    grid.setStrength(0.5);
    expect((grid.object.material as THREE.LineBasicMaterial).opacity).toBeCloseTo(full / 2, 6);

    grid.setStrength(0);
    expect(grid.object.visible).toBe(false);
  });

  it('clamps strength rather than letting opacity run past one', () => {
    grid.setStrength(4);
    expect((grid.object.material as THREE.LineBasicMaterial).opacity).toBeLessThanOrEqual(1);
    grid.setStrength(-1);
    expect(grid.object.visible).toBe(false);
  });

  it('lies in the galactic plane through its centre once placed in the scene', () => {
    grid.object.updateMatrixWorld(true);
    const normal = galacticNormal();

    for (const index of [0, 100, 1000, grid.object.geometry.getAttribute('position').count - 1]) {
      const world = vertexAt(grid.object.geometry, index).applyMatrix4(grid.object.matrixWorld);
      expect(world.dot(normal)).toBeCloseTo(0, 6);
    }
  });

  it('sits on the galactic centre when given it, still in the plane', () => {
    const centre = galacticCentrePositionPc();
    const galacticGrid = new PolarGridPlane({
      ringRadiiPc: [2500, 8178],
      spokeCount: 4,
      centrePc: new THREE.Vector3(centre.x, centre.y, centre.z)
    });
    galacticGrid.object.updateMatrixWorld(true);

    const normal = galacticNormal();
    const world = vertexAt(galacticGrid.object.geometry, 0).applyMatrix4(galacticGrid.object.matrixWorld);
    // The centre is one Sun-height below the Sun's own plane, and the grid follows it there.
    expect(world.dot(normal)).toBeCloseTo(-SUN_HEIGHT_ABOVE_MIDPLANE_PC, 4);

    galacticGrid.dispose();
  });

  it('keeps the emphasised ring brighter than the rest', () => {
    const colors = grid.object.geometry.getAttribute('color');
    // Vertices are written ring by ring, in the order they were listed: 10 pc first, 50 pc last.
    const innerBrightness = colors.getX(0) + colors.getY(0) + colors.getZ(0);
    const emphasisIndex = 2 * SEGMENTS_PER_RING * 2;
    const emphasisBrightness = colors.getX(emphasisIndex) + colors.getY(emphasisIndex) + colors.getZ(emphasisIndex);
    expect(emphasisBrightness).toBeGreaterThan(innerBrightness);
  });
});

describe('TetherField', () => {
  it('drops each point onto the plane, straight down the galactic normal', () => {
    const field = new TetherField(4);
    const point = new THREE.Vector3(12, -7, 30);
    field.setTargets([point]);

    const geometry = field.object.geometry;
    const top = vertexAt(geometry, 0);
    const foot = vertexAt(geometry, 1);
    const normal = galacticNormal();

    expect(top.distanceTo(point)).toBeCloseTo(0, 4);
    // The foot is in the plane...
    expect(foot.dot(normal)).toBeCloseTo(0, 4);
    // ...and directly below the point: the drop has no sideways component.
    const drop = top.clone().sub(foot);
    expect(drop.clone().cross(normal).length()).toBeCloseTo(0, 4);

    field.dispose();
  });

  it('drops onto an offset plane when asked, for a grid on the true midplane', () => {
    const field = new TetherField(2);
    field.setTargets([new THREE.Vector3(0, 0, 100)], -SUN_HEIGHT_ABOVE_MIDPLANE_PC);

    const foot = vertexAt(field.object.geometry, 1);
    expect(foot.dot(galacticNormal())).toBeCloseTo(-SUN_HEIGHT_ABOVE_MIDPLANE_PC, 4);

    field.dispose();
  });

  it('draws two vertices per tether and nothing for the ones it was not given', () => {
    const field = new TetherField(8);
    field.setTargets([new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6)]);
    expect(field.object.geometry.drawRange.count).toBe(4);

    field.setTargets([]);
    expect(field.object.geometry.drawRange.count).toBe(0);

    field.dispose();
  });

  it('drops points past its capacity rather than overrunning the buffer', () => {
    const field = new TetherField(2);
    const points = [new THREE.Vector3(1, 0, 5), new THREE.Vector3(2, 0, 5), new THREE.Vector3(3, 0, 5), new THREE.Vector3(4, 0, 5)];
    expect(() => field.setTargets(points)).not.toThrow();
    expect(field.object.geometry.drawRange.count).toBe(4);
    expect(field.object.geometry.getAttribute('position').count).toBe(4);

    field.dispose();
  });

  it('stays hidden until it is given a strength', () => {
    const field = new TetherField(2);
    expect(field.object.visible).toBe(false);

    field.setStrength(1);
    expect(field.object.visible).toBe(true);
    field.setStrength(0);
    expect(field.object.visible).toBe(false);

    field.dispose();
  });
});
