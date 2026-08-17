import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { GALACTIC_LANDMARKS } from '../../shared/astro/galaxy';
import { GALAXY_FADE_FAR_PC, GALAXY_FADE_NEAR_PC, MilkyWayRenderer } from './milky-way-renderer';

const SMALL_COUNTS = { arms: 400, disc: 200, bulge: 200, halo: 50 };

describe('MilkyWayRenderer', () => {
  it('draws one instance per particle the model placed', () => {
    const renderer = new MilkyWayRenderer(5, SMALL_COUNTS);
    expect(renderer.particleCount).toBeGreaterThan(0);
    expect((renderer.object.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(renderer.particleCount);
    renderer.dispose();
  });

  it('stays hidden until the camera has pulled back, so the local view pays nothing for it', () => {
    const renderer = new MilkyWayRenderer(5, SMALL_COUNTS);
    expect(renderer.object.visible).toBe(false);

    expect(renderer.setViewerDistancePc(50)).toBe(0);
    expect(renderer.object.visible).toBe(false);

    renderer.dispose();
  });

  it('fades in across the crossfade band and holds at full strength beyond it', () => {
    const renderer = new MilkyWayRenderer(5, SMALL_COUNTS);

    expect(renderer.setViewerDistancePc(GALAXY_FADE_NEAR_PC)).toBe(0);
    expect(renderer.setViewerDistancePc((GALAXY_FADE_NEAR_PC + GALAXY_FADE_FAR_PC) / 2)).toBeCloseTo(0.5, 6);
    expect(renderer.setViewerDistancePc(GALAXY_FADE_FAR_PC)).toBe(1);
    expect(renderer.setViewerDistancePc(80000)).toBe(1);
    expect(renderer.object.visible).toBe(true);
    expect(renderer.strength).toBe(1);

    renderer.dispose();
  });

  it('never culls itself, since its instances are nowhere near the geometry it was built from', () => {
    // The billboard quad sits at the origin and the particles are placed in the vertex shader,
    // so the mesh's own bounds say nothing about where it is drawn.
    const renderer = new MilkyWayRenderer(5, SMALL_COUNTS);
    expect(renderer.object.frustumCulled).toBe(false);
    renderer.dispose();
  });

  it('offers a label anchor for every structural landmark, namespaced away from the star ids', () => {
    const renderer = new MilkyWayRenderer(5, SMALL_COUNTS);
    const labels = renderer.labelPoints();

    expect(labels).toHaveLength(GALACTIC_LANDMARKS.length);
    expect(labels.map((label) => label.name)).toContain('Sagittarius A*');
    for (const label of labels) {
      expect(String(label.id).startsWith('galactic:')).toBe(true);
      expect(Number.isFinite(label.x + label.y + label.z)).toBe(true);
    }

    renderer.dispose();
  });

  it('detaches itself on dispose, so a torn-down scene does not keep it alive', () => {
    const renderer = new MilkyWayRenderer(5, SMALL_COUNTS);
    new THREE.Group().add(renderer.object);

    renderer.dispose();
    expect(renderer.object.parent).toBeNull();
  });
});
