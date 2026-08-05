import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { DEFAULT_EPOCH_JD } from '../../shared/astro/constants';
import { eclipticToEquatorial, OBLIQUITY_J2000_DEG } from '../../shared/astro/coordinates';
import { BodyRecord } from '../../shared/models/body.model';
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

  describe('reference frame', () => {
    /** Earth: inclination 0 by definition — its orbit *is* the ecliptic plane. */
    const EARTH: BodyRecord = {
      id: 'earth',
      systemStarId: 0,
      name: 'Earth',
      kind: 'planet',
      radiusKm: 6371,
      orbit: {
        semiMajorAxisAu: 1,
        eccentricity: 0.0167,
        inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        epochJd: DEFAULT_EPOCH_JD
      }
    };

    it('places an ecliptic orbit in the ecliptic plane of the equatorial scene', () => {
      // Horizons reports elements against the ecliptic; the scene is equatorial, to match the
      // star catalogue. So Earth's orbit must come out tilted, lying perpendicular to the
      // *ecliptic* pole rather than to the scene's own vertical.
      const renderer = new SystemOrbitsRenderer([EARTH], []);
      const eclipticPole = eclipticToEquatorial({ x: 0, y: 0, z: 1 });

      for (const offset of [0, 40, 91, 200, 300]) {
        renderer.update(DEFAULT_EPOCH_JD + offset);
        const p = renderer.members[0].marker.position;
        const outOfPlane = p.x * eclipticPole.x + p.y * eclipticPole.y + p.z * eclipticPole.z;
        expect(Math.abs(outOfPlane)).toBeLessThan(1e-9);
      }
      renderer.dispose();
    });

    it('tilts that orbit away from the celestial equator by the obliquity', () => {
      // The discriminating check: before the frames were reconciled, the orbit sat flat in the
      // scene and this angle was zero.
      const renderer = new SystemOrbitsRenderer([EARTH], []);
      renderer.update(DEFAULT_EPOCH_JD + 91); // a quarter orbit on, well away from the equinox

      const p = renderer.members[0].marker.position;
      const latitudeDeg = (Math.asin(p.z / p.length()) * 180) / Math.PI;

      expect(Math.abs(latitudeDeg)).toBeGreaterThan(1);
      expect(Math.abs(latitudeDeg)).toBeLessThanOrEqual(OBLIQUITY_J2000_DEG + 1e-6);
      renderer.dispose();
    });

    it('keeps the vernal equinox direction shared between the two frames', () => {
      // A body at ecliptic longitude 0 sits on the +X axis in both frames, so it must not move.
      const atEquinox: BodyRecord = { ...EARTH, orbit: { ...EARTH.orbit, eccentricity: 0 } };
      const renderer = new SystemOrbitsRenderer([atEquinox], []);
      renderer.update(DEFAULT_EPOCH_JD);

      const p = renderer.members[0].marker.position;
      expect(p.x).toBeCloseTo(1, 6);
      expect(p.y).toBeCloseTo(0, 9);
      expect(p.z).toBeCloseTo(0, 9);
      renderer.dispose();
    });

    it('reads the solar system against the ecliptic and everything else against the sky plane', () => {
      const solar = new SystemOrbitsRenderer([EARTH], []);
      const eclipticPole = eclipticToEquatorial({ x: 0, y: 0, z: 1 });
      const solarNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(solar.referenceFrame);
      expect(solarNormal.dot(new THREE.Vector3(eclipticPole.x, eclipticPole.y, eclipticPole.z))).toBeCloseTo(1, 9);
      solar.dispose();

      const lineOfSight = { x: 0.3, y: -0.5, z: 0.81 };
      const exo = new SystemOrbitsRenderer([], [exoplanet()], lineOfSight);
      const exoNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(exo.referenceFrame);
      const expected = new THREE.Vector3(lineOfSight.x, lineOfSight.y, lineOfSight.z).normalize();
      expect(exoNormal.dot(expected)).toBeCloseTo(1, 9);
      exo.dispose();
    });
  });

  describe('reference grid', () => {
    /** A body far enough out to give the grid something to measure. */
    const JUPITER: BodyRecord = {
      id: 'jupiter',
      systemStarId: 0,
      name: 'Jupiter',
      kind: 'planet',
      radiusKm: 69911,
      orbit: { semiMajorAxisAu: 5.2, eccentricity: 0.048, inclinationDeg: 1.3, longitudeOfAscendingNodeDeg: 100, argumentOfPeriapsisDeg: 275, meanAnomalyAtEpochDeg: 20, epochJd: DEFAULT_EPOCH_JD }
    };

    /** The grid and the tethers are the only line objects the renderer adds outside a pivot. */
    function planeObjects(renderer: SystemOrbitsRenderer): THREE.LineSegments[] {
      return renderer.object.children.filter((child): child is THREE.LineSegments => child instanceof THREE.LineSegments);
    }

    it('lays a grid and tethers in the system plane', () => {
      const renderer = new SystemOrbitsRenderer([JUPITER], []);
      expect(planeObjects(renderer)).toHaveLength(2);
      renderer.dispose();
    });

    it('drops a tether from every top-level body onto that plane, and follows them', () => {
      const renderer = new SystemOrbitsRenderer([], [exoplanet({ periodDays: TRAPPIST_1B_PERIOD_DAYS })]);
      renderer.update(DEFAULT_EPOCH_JD);

      // The tether field is the one with an explicit draw range; the grid leaves it at Infinity.
      const tethers = planeObjects(renderer).find((object) => Number.isFinite(object.geometry.drawRange.count))!;
      const readTop = (): THREE.Vector3 => {
        const position = tethers.geometry.getAttribute('position');
        return new THREE.Vector3(position.getX(0), position.getY(0), position.getZ(0));
      };

      // The tether's top is the marker, wherever the marker currently is.
      expect(readTop().distanceTo(renderer.members[0].marker.position)).toBeCloseTo(0, 9);
      const before = readTop();

      renderer.update(DEFAULT_EPOCH_JD + TRAPPIST_1B_PERIOD_DAYS / 2);
      expect(readTop().distanceTo(renderer.members[0].marker.position)).toBeCloseTo(0, 9);
      expect(readTop().distanceTo(before)).toBeGreaterThan(0);

      renderer.dispose();
    });

    it('draws no grid for a star with no known planets', () => {
      // Nothing to measure, and a bare ring around a lone star would imply a scale it does not
      // have.
      const renderer = new SystemOrbitsRenderer([], []);
      expect(planeObjects(renderer)).toHaveLength(0);
      renderer.dispose();
    });

    it('detaches the grid on dispose along with everything else', () => {
      const renderer = new SystemOrbitsRenderer([JUPITER], []);
      const [grid] = planeObjects(renderer);
      renderer.dispose();
      expect(grid.parent).toBeNull();
    });
  });

  describe('exoplanet inclination is measured from the plane of the sky', () => {
    // A host somewhere off all three axes, so nothing can pass by coincidence.
    const LINE_OF_SIGHT = new THREE.Vector3(0.37, -0.62, 0.69).normalize();

    function circular(inclinationDeg: number): ExoplanetRecord {
      return exoplanet({ orbit: { semiMajorAxisAu: 0.5, eccentricity: 0, inclinationDeg } });
    }

    /** Normal of the plane the rendered orbit actually lies in. */
    function orbitNormal(renderer: SystemOrbitsRenderer): THREE.Vector3 {
      const a = positionAt(renderer, DEFAULT_EPOCH_JD);
      const b = positionAt(renderer, DEFAULT_EPOCH_JD + 20);
      return new THREE.Vector3().crossVectors(a, b).normalize();
    }

    it('tilts the orbit by the published inclination away from the line of sight', () => {
      // The definition: inclination is the angle between the orbital axis and our line of
      // sight to the star. Reading it as an ecliptic inclination instead tips the orbit against
      // a plane it was never measured against.
      for (const inclinationDeg of [0, 30, 60, 88.9, 90]) {
        const renderer = new SystemOrbitsRenderer([], [circular(inclinationDeg)], LINE_OF_SIGHT);
        const angleDeg = (Math.acos(Math.abs(orbitNormal(renderer).dot(LINE_OF_SIGHT))) * 180) / Math.PI;

        expect(angleDeg).toBeCloseTo(inclinationDeg <= 90 ? inclinationDeg : 180 - inclinationDeg, 4);
        renderer.dispose();
      }
    });

    it('makes an edge-on planet actually transit its star as seen from Earth', () => {
      // 90 degrees means edge-on to us, which is why transiting planets cluster there. So some
      // point on the orbit must lie along the line of sight — in front of or behind the star.
      const renderer = new SystemOrbitsRenderer([], [circular(90)], LINE_OF_SIGHT);

      let closestToLineOfSight = 0;
      for (let day = 0; day < 120; day++) {
        const p = positionAt(renderer, DEFAULT_EPOCH_JD + day).normalize();
        closestToLineOfSight = Math.max(closestToLineOfSight, Math.abs(p.dot(LINE_OF_SIGHT)));
      }

      expect(closestToLineOfSight).toBeGreaterThan(0.99);
      renderer.dispose();
    });

    it('keeps a face-on planet in the plane of the sky, never transiting', () => {
      const renderer = new SystemOrbitsRenderer([], [circular(0)], LINE_OF_SIGHT);

      for (let day = 0; day < 120; day += 7) {
        const p = positionAt(renderer, DEFAULT_EPOCH_JD + day).normalize();
        expect(Math.abs(p.dot(LINE_OF_SIGHT))).toBeLessThan(1e-9);
      }
      renderer.dispose();
    });

    it('places identical elements differently for hosts in different directions', () => {
      // Each system is oriented against its own line of sight, so the same elements around two
      // stars in different parts of the sky do not land in the same place.
      //
      // Note this checks position, not the plane's normal. With no published node angle the
      // rotation about the line of sight is arbitrary, so two planes can come out near-parallel
      // by coincidence while each still sits at its correct inclination to its own host — which
      // is the property the test above pins.
      const here = new SystemOrbitsRenderer([], [circular(88.9)], new THREE.Vector3(1, 0, 0));
      const there = new SystemOrbitsRenderer([], [circular(88.9)], new THREE.Vector3(0, 0, 1));

      expect(positionAt(here, DEFAULT_EPOCH_JD).distanceTo(positionAt(there, DEFAULT_EPOCH_JD))).toBeGreaterThan(0.1);
      here.dispose();
      there.dispose();
    });

    it('falls back to the ecliptic frame when the host direction is unknown', () => {
      const withoutHost = new SystemOrbitsRenderer([], [circular(0)]);
      const eclipticPole = eclipticToEquatorial({ x: 0, y: 0, z: 1 });

      expect(Math.abs(orbitNormal(withoutHost).dot(new THREE.Vector3(eclipticPole.x, eclipticPole.y, eclipticPole.z)))).toBeCloseTo(1, 9);
      withoutHost.dispose();
    });

    it('ignores a zero-length host direction rather than producing NaN', () => {
      const renderer = new SystemOrbitsRenderer([], [circular(45)], new THREE.Vector3(0, 0, 0));
      const p = positionAt(renderer, DEFAULT_EPOCH_JD);

      expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
      renderer.dispose();
    });
  });
});
