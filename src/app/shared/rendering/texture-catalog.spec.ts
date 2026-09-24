import { describe, expect, it } from 'vitest';

import { bodyTexturePath } from './texture-catalog';

describe('bodyTexturePath', () => {
  it('wraps the moons and dwarf planets that have a mission mosaic in it', () => {
    const mapped = ['phobos', 'io', 'europa', 'ganymede', 'callisto', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus', 'phoebe', 'triton', 'ceres', 'pluto', 'charon'];
    for (const id of mapped) {
      expect(bodyTexturePath(id)).toBe(`assets/textures/bodies/${id}.jpg`);
    }
  });

  it('leaves the bodies with no map it could check to their derived surface', () => {
    for (const id of ['deimos', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon', 'hyperion', 'eris']) {
      expect(bodyTexturePath(id)).toBeUndefined();
    }
  });
});
