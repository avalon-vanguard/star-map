import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { bodyTexturePath, saturnRing } from './texture-catalog';

describe('bodyTexturePath', () => {
  it('wraps the moons and dwarf planets that have a mission mosaic in it', () => {
    const mapped = ['phobos', 'deimos', 'io', 'europa', 'ganymede', 'callisto', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus', 'phoebe', 'triton', 'ceres', 'pluto', 'charon'];
    for (const id of mapped) {
      expect(bodyTexturePath(id)).toBe(`assets/textures/bodies/${id}.jpg`);
    }
  });

  it('leaves the bodies with no map it could check to their derived surface', () => {
    for (const id of ['miranda', 'ariel', 'umbriel', 'titania', 'oberon', 'hyperion', 'eris']) {
      expect(bodyTexturePath(id)).toBeUndefined();
    }
  });
});

describe('saturnRing', () => {
  const SATURN_RADIUS_KM = 58232;

  /** Each vertex's distance from the centre, in km, beside the texture coordinate it samples. */
  function radiiAndU(ring: THREE.Mesh, kmPerUnit: number): Array<{ km: number; u: number; y: number }> {
    const position = ring.geometry.attributes['position'];
    const uv = ring.geometry.attributes['uv'];
    const vertex = new THREE.Vector3();
    return Array.from({ length: position.count }, (_, i) => {
      vertex.fromBufferAttribute(position, i);
      return { km: vertex.length() * kmPerUnit, u: uv.getX(i), y: vertex.y };
    });
  }

  it('reaches from 69 400 to 141 000 km, drawn against the planet at whatever size it is drawn', () => {
    for (const drawnRadius of [1, 3.9e-4]) {
      const radii = radiiAndU(saturnRing(SATURN_RADIUS_KM, drawnRadius), SATURN_RADIUS_KM / drawnRadius).map(({ km }) => km);
      expect(Math.min(...radii)).toBeCloseTo(69400, 0);
      expect(Math.max(...radii)).toBeCloseTo(141000, 0);
    }
  });

  it('lies in the equator of a sphere built round +Y', () => {
    for (const { y } of radiiAndU(saturnRing(SATURN_RADIUS_KM, 1), SATURN_RADIUS_KM)) {
      expect(Math.abs(y)).toBeLessThan(1e-12);
    }
  });

  it('samples the strip outwards, so its B ring starts at 92 000 km and its A ring ends at 136 775', () => {
    // Where the strip's alpha jumps: 404.5 and 1 204 of its 1 280 px.
    const vertices = radiiAndU(saturnRing(SATURN_RADIUS_KM, 1), SATURN_RADIUS_KM);
    const inner = vertices.reduce((a, b) => (b.km < a.km ? b : a));
    const outer = vertices.reduce((a, b) => (b.km > a.km ? b : a));
    const uAt = (km: number): number => inner.u + ((km - inner.km) / (outer.km - inner.km)) * (outer.u - inner.u);
    expect(Math.abs(uAt(92000) * 1280 - 404.5)).toBeLessThan(1.5);
    expect(Math.abs(uAt(136775) * 1280 - 1204)).toBeLessThan(1.5);
  });
});
