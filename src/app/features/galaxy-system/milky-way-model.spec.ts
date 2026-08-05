import { describe, expect, it } from 'vitest';

import { DISC_RADIUS_PC, equatorialToGalactic, SUN_GALACTOCENTRIC_RADIUS_PC, SUN_HEIGHT_ABOVE_MIDPLANE_PC } from '../../shared/astro/galaxy';
import { createRandom, DEFAULT_PARTICLE_COUNTS, generateMilkyWayParticles } from './milky-way-model';

/** A small, fast budget — the shape of the model does not depend on how many particles trace it. */
const TEST_COUNTS = { arms: 3000, disc: 1500, bulge: 1200, halo: 200 };
const TEST_BUDGET = TEST_COUNTS.arms + TEST_COUNTS.disc + TEST_COUNTS.bulge + TEST_COUNTS.halo;

/** Galactocentric radius and height above the midplane of the i-th particle, in parsecs. */
function galactocentric(positions: Float32Array, index: number): { radiusPc: number; heightPc: number } {
  const galactic = equatorialToGalactic({ x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2] });
  return {
    radiusPc: Math.hypot(SUN_GALACTOCENTRIC_RADIUS_PC - galactic.x, galactic.y),
    heightPc: galactic.z + SUN_HEIGHT_ABOVE_MIDPLANE_PC
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('createRandom', () => {
  it('is deterministic for a given seed', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b());
    }
  });

  it('stays inside the unit interval', () => {
    const random = createRandom(99);
    for (let i = 0; i < 5000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('produces different streams for different seeds', () => {
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });
});

describe('generateMilkyWayParticles', () => {
  const particles = generateMilkyWayParticles(1234, TEST_COUNTS);

  it('is the same Galaxy on every run, so the map does not reshuffle on reload', () => {
    const again = generateMilkyWayParticles(1234, TEST_COUNTS);
    expect(again.count).toBe(particles.count);
    expect(Array.from(again.positions.slice(0, 300))).toEqual(Array.from(particles.positions.slice(0, 300)));
  });

  it('places most of the requested budget, rejecting only the samples that miss', () => {
    expect(particles.count).toBeLessThanOrEqual(TEST_BUDGET);
    expect(particles.count).toBeGreaterThan(TEST_BUDGET * 0.75);
  });

  it('emits finite positions, sizes and alphas throughout', () => {
    for (let index = 0; index < particles.count; index++) {
      expect(Number.isFinite(particles.positions[index * 3])).toBe(true);
      expect(Number.isFinite(particles.positions[index * 3 + 1])).toBe(true);
      expect(Number.isFinite(particles.positions[index * 3 + 2])).toBe(true);
      expect(particles.sizes[index]).toBeGreaterThan(0);
      expect(particles.alphas[index]).toBeGreaterThan(0);
      expect(particles.alphas[index]).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every colour channel inside the displayable range', () => {
    for (let index = 0; index < particles.count * 3; index++) {
      expect(particles.colors[index]).toBeGreaterThanOrEqual(0);
      expect(particles.colors[index]).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every particle inside the modelled galaxy, halo included', () => {
    for (let index = 0; index < particles.count; index++) {
      expect(galactocentric(particles.positions, index).radiusPc).toBeLessThan(DISC_RADIUS_PC * 1.3);
    }
  });

  it('builds a disc rather than a ball: half the particles sit within 300 pc of the midplane', () => {
    const heights: number[] = [];
    for (let index = 0; index < particles.count; index++) {
      heights.push(Math.abs(galactocentric(particles.positions, index).heightPc));
    }
    expect(median(heights)).toBeLessThan(300);
  });

  it('leaves the centre denser than the outskirts', () => {
    let inner = 0;
    let outer = 0;
    for (let index = 0; index < particles.count; index++) {
      const { radiusPc } = galactocentric(particles.positions, index);
      if (radiusPc < 4000) {
        inner++;
      } else if (radiusPc > 12000) {
        outer++;
      }
    }
    expect(inner).toBeGreaterThan(outer);
  });

  it('puts the Sun in the disc, not off its edge', () => {
    // The whole point of the placement: the local star field has to sit inside the model, about
    // half way out, rather than floating beside it.
    let neighbours = 0;
    for (let index = 0; index < particles.count; index++) {
      const x = particles.positions[index * 3];
      const y = particles.positions[index * 3 + 1];
      const z = particles.positions[index * 3 + 2];
      if (Math.hypot(x, y, z) < 2000) {
        neighbours++;
      }
    }
    expect(neighbours).toBeGreaterThan(0);
  });

  it('spans a full turn in azimuth, so the arms wrap rather than forming a fan', () => {
    const quadrants = new Set<number>();
    for (let index = 0; index < particles.count; index++) {
      const galactic = equatorialToGalactic({
        x: particles.positions[index * 3],
        y: particles.positions[index * 3 + 1],
        z: particles.positions[index * 3 + 2]
      });
      const angle = Math.atan2(galactic.y, SUN_GALACTOCENTRIC_RADIUS_PC - galactic.x);
      quadrants.add(Math.floor(((angle + Math.PI) / (Math.PI / 2)) % 4));
    }
    expect(quadrants.size).toBe(4);
  });

  it('defaults to a budget big enough to read as a galaxy', () => {
    expect(DEFAULT_PARTICLE_COUNTS.arms).toBeGreaterThan(DEFAULT_PARTICLE_COUNTS.disc);
    expect(DEFAULT_PARTICLE_COUNTS.halo).toBeLessThan(DEFAULT_PARTICLE_COUNTS.bulge);
  });
});
