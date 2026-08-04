import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { DEFAULT_EPOCH_JD } from '../../shared/astro/constants';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { SystemOrbitsRenderer } from './system-orbits-renderer';

/** TRAPPIST-1 b: a real short-period planet around a 0.09 solar-mass red dwarf. */
const TRAPPIST_1B_SEMI_MAJOR_AXIS_AU = 0.01154;
const TRAPPIST_1B_PERIOD_DAYS = 1.51088;

function exoplanet(overrides: Partial<ExoplanetRecord> = {}): ExoplanetRecord {
  return {
    id: 'TRAPPIST-1 b',
    hostStarId: 1,
    hostStarName: 'TRAPPIST-1',
    name: 'TRAPPIST-1 b',
    orbit: { semiMajorAxisAu: TRAPPIST_1B_SEMI_MAJOR_AXIS_AU, eccentricity: 0 },
    ...overrides
  };
}

/** Marker position for the system's single exoplanet at a given Julian date. */
function positionAt(renderer: SystemOrbitsRenderer, epochJd: number): THREE.Vector3 {
  renderer.update(epochJd);
  return renderer.members[0].marker.position.clone();
}

describe('SystemOrbitsRenderer exoplanet propagation', () => {
  it('completes exactly one orbit over the measured period', () => {
    // The end-to-end check that the period actually reaches the propagator: after one full
    // published period the planet must be back where it started.
    const renderer = new SystemOrbitsRenderer([], [exoplanet({ periodDays: TRAPPIST_1B_PERIOD_DAYS })]);

    const start = positionAt(renderer, DEFAULT_EPOCH_JD);
    const afterOnePeriod = positionAt(renderer, DEFAULT_EPOCH_JD + TRAPPIST_1B_PERIOD_DAYS);
    const afterHalfPeriod = positionAt(renderer, DEFAULT_EPOCH_JD + TRAPPIST_1B_PERIOD_DAYS / 2);

    expect(afterOnePeriod.distanceTo(start)).toBeLessThan(1e-6);
    // Half an orbit of a circle is the far side, a full diameter away.
    expect(afterHalfPeriod.distanceTo(start)).toBeCloseTo(2 * TRAPPIST_1B_SEMI_MAJOR_AXIS_AU, 6);
    renderer.dispose();
  });

  it('moves a red dwarf planet more slowly than the old solar-mass assumption did', () => {
    // Assuming a solar-mass host made TRAPPIST-1's planets orbit about 3.3x too fast, so the
    // corrected planet must have travelled less far after the same elapsed time.
    const corrected = new SystemOrbitsRenderer([], [exoplanet({ periodDays: TRAPPIST_1B_PERIOD_DAYS })]);
    const assumingSolar = new SystemOrbitsRenderer([], [exoplanet()]);

    const elapsed = TRAPPIST_1B_PERIOD_DAYS / 8;
    const correctedTravel = positionAt(corrected, DEFAULT_EPOCH_JD).distanceTo(positionAt(corrected, DEFAULT_EPOCH_JD + elapsed));
    const solarTravel = positionAt(assumingSolar, DEFAULT_EPOCH_JD).distanceTo(
      positionAt(assumingSolar, DEFAULT_EPOCH_JD + elapsed)
    );

    expect(correctedTravel).toBeLessThan(solarTravel);
    corrected.dispose();
    assumingSolar.dispose();
  });

  it('uses the host star mass when no period is published', () => {
    const fromMass = new SystemOrbitsRenderer([], [exoplanet({ hostStarMassSolar: 0.0898 })]);
    const fromPeriod = new SystemOrbitsRenderer([], [exoplanet({ periodDays: TRAPPIST_1B_PERIOD_DAYS })]);

    const elapsed = 0.3;
    const massTravel = positionAt(fromMass, DEFAULT_EPOCH_JD).distanceTo(positionAt(fromMass, DEFAULT_EPOCH_JD + elapsed));
    const periodTravel = positionAt(fromPeriod, DEFAULT_EPOCH_JD).distanceTo(positionAt(fromPeriod, DEFAULT_EPOCH_JD + elapsed));

    // The published mass and the period-derived mass agree, so the two must nearly coincide.
    expect(massTravel).toBeCloseTo(periodTravel, 4);
    fromMass.dispose();
    fromPeriod.dispose();
  });

  it('still renders an exoplanet that has neither a period nor a host mass', () => {
    const renderer = new SystemOrbitsRenderer([], [exoplanet()]);

    expect(renderer.members).toHaveLength(1);
    expect(positionAt(renderer, DEFAULT_EPOCH_JD).length()).toBeCloseTo(TRAPPIST_1B_SEMI_MAJOR_AXIS_AU, 6);
    renderer.dispose();
  });

  it('skips an exoplanet with no semi-major axis rather than crashing', () => {
    const renderer = new SystemOrbitsRenderer([], [exoplanet({ orbit: { eccentricity: 0 } })]);

    expect(renderer.members).toHaveLength(0);
    renderer.dispose();
  });

  describe('orbits with no published eccentricity', () => {
    // The archive publishes a semi-major axis far more often than an eccentricity. Requiring
    // both dropped 1509 otherwise drawable planets.
    it('draws a planet that has an axis but no eccentricity', () => {
      const renderer = new SystemOrbitsRenderer([], [exoplanet({ orbit: { semiMajorAxisAu: 0.4 } })]);

      expect(renderer.members).toHaveLength(1);
      renderer.dispose();
    });

    it('places it on a circle of the right radius', () => {
      const renderer = new SystemOrbitsRenderer([], [exoplanet({ orbit: { semiMajorAxisAu: 0.4 } })]);

      for (const offset of [0, 5, 20, 60]) {
        expect(positionAt(renderer, DEFAULT_EPOCH_JD + offset).length()).toBeCloseTo(0.4, 6);
      }
      renderer.dispose();
    });

    it('still honours the measured period', () => {
      const renderer = new SystemOrbitsRenderer(
        [],
        [exoplanet({ orbit: { semiMajorAxisAu: TRAPPIST_1B_SEMI_MAJOR_AXIS_AU }, periodDays: TRAPPIST_1B_PERIOD_DAYS })]
      );

      const start = positionAt(renderer, DEFAULT_EPOCH_JD);
      const afterOnePeriod = positionAt(renderer, DEFAULT_EPOCH_JD + TRAPPIST_1B_PERIOD_DAYS);
      expect(afterOnePeriod.distanceTo(start)).toBeLessThan(1e-6);
      renderer.dispose();
    });
  });

  it('skips an escape trajectory rather than emitting NaN positions', () => {
    // e >= 1 is not an ellipse; propagating it anyway yields NaN, which poisons the geometry's
    // bounding sphere and disables culling for the whole object.
    const renderer = new SystemOrbitsRenderer([], [exoplanet({ orbit: { semiMajorAxisAu: 1, eccentricity: 1.4 } })]);

    expect(renderer.members).toHaveLength(0);
    renderer.dispose();
  });

  it('skips a non-positive semi-major axis', () => {
    const renderer = new SystemOrbitsRenderer([], [exoplanet({ orbit: { semiMajorAxisAu: 0, eccentricity: 0.1 } })]);

    expect(renderer.members).toHaveLength(0);
    renderer.dispose();
  });

  it('keeps every propagated position finite', () => {
    const renderer = new SystemOrbitsRenderer([], [exoplanet({ periodDays: TRAPPIST_1B_PERIOD_DAYS, orbit: { semiMajorAxisAu: TRAPPIST_1B_SEMI_MAJOR_AXIS_AU, eccentricity: 0.62 } })]);

    for (const offset of [0, 0.1, 1, 10, 1000]) {
      const { x, y, z } = positionAt(renderer, DEFAULT_EPOCH_JD + offset);
      expect([x, y, z].every(Number.isFinite)).toBe(true);
    }
    renderer.dispose();
  });
});
