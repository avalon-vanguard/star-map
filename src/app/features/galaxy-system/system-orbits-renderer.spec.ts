import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { DEFAULT_EPOCH_JD, GM_SUN_AU3_PER_DAY2 } from '../../shared/astro/constants';
import { keplerRates } from '../../shared/astro/kepler';
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
      },
      rates: keplerRates(1, GM_SUN_AU3_PER_DAY2), orbitSource: 'test'
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
      orbit: { semiMajorAxisAu: 5.2, eccentricity: 0.048, inclinationDeg: 1.3, longitudeOfAscendingNodeDeg: 100, argumentOfPeriapsisDeg: 275, meanAnomalyAtEpochDeg: 20, epochJd: DEFAULT_EPOCH_JD },
      rates: keplerRates(5.2, GM_SUN_AU3_PER_DAY2),
      orbitSource: 'test'
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

describe('rotation', () => {
  /** Earth, near enough: a day of 23.934 h, tipped 23.44 degrees off its orbit. */
  function spinning(overrides: Partial<BodyRecord> = {}): BodyRecord {
    return {
      id: 'earth',
      systemStarId: 0,
      name: 'Earth',
      kind: 'planet',
      radiusKm: 6371,
      orbit: { semiMajorAxisAu: 1, eccentricity: 0.0167, inclinationDeg: 0, longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0, epochJd: DEFAULT_EPOCH_JD },
      rates: keplerRates(1, GM_SUN_AU3_PER_DAY2), orbitSource: 'test',
      rotationPeriodHours: 23.934,
      obliquityDeg: 23.4392911,
      ...overrides
    };
  }

  /** How far the marker has turned about its own axis between two dates, in degrees. */
  function turnedDegrees(body: BodyRecord, afterDays: number): number {
    const renderer = new SystemOrbitsRenderer([body], [], undefined, 1);
    renderer.update(DEFAULT_EPOCH_JD);
    const start = renderer.members[0].marker.quaternion.clone();
    renderer.update(DEFAULT_EPOCH_JD + afterDays);
    const turn = start.invert().multiply(renderer.members[0].marker.quaternion);
    const axis = new THREE.Vector3();
    const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    turn.normalize();
    axis.set(turn.x, turn.y, turn.z);
    const signed = axis.y >= 0 ? angle : -angle;
    return (signed * 180) / Math.PI;
  }

  it('turns a body once per its own sidereal day', () => {
    // A full turn in 23.934 h, so a quarter of that is a quarter turn.
    expect(Math.abs(turnedDegrees(spinning(), 23.934 / 96))).toBeCloseTo(90, 1);
  });

  /**
   * Which way a body spins in the world: its angular velocity projected on its orbit's normal.
   * Positive is prograde, turning the same way it goes round; negative is retrograde.
   */
  function spinSense(body: BodyRecord): number {
    const renderer = new SystemOrbitsRenderer([body], [], undefined, 1);
    renderer.update(DEFAULT_EPOCH_JD);
    const start = renderer.members[0].marker.quaternion.clone();
    renderer.update(DEFAULT_EPOCH_JD + 0.01);
    const turn = renderer.members[0].marker.quaternion.clone().multiply(start.invert());
    const axis = new THREE.Vector3(turn.x, turn.y, turn.z).multiplyScalar(Math.sign(turn.w));
    return axis.normalize().dot(new THREE.Vector3(0, 0, 1).applyQuaternion(renderer.referenceFrame));
  }

  it('turns Venus backwards, as Horizons gives it: a negative rate and an obliquity past 90', () => {
    // Both say retrograde, in two conventions. Applied together they cancelled into a forward
    // turn, which is how Venus and Uranus used to be drawn.
    const venus = spinning({ id: 'venus', rotationPeriodHours: -5832.54, obliquityDeg: 177.3 });

    expect(spinSense(spinning())).toBeGreaterThan(0.9);
    expect(spinSense(venus)).toBeLessThan(-0.9);
  });

  it('reads the sign of the period only where no obliquity says which way the pole points', () => {
    expect(spinSense(spinning({ rotationPeriodHours: -23.934, obliquityDeg: undefined }))).toBeLessThan(-0.9);
    expect(spinSense(spinning({ rotationPeriodHours: 23.934, obliquityDeg: undefined }))).toBeGreaterThan(0.9);
  });

  it('leaves a body with no published rotation still', () => {
    // Titan: Horizons states no period for it, and an invented one would be a claim.
    const renderer = new SystemOrbitsRenderer([spinning({ rotationPeriodHours: undefined })], [], undefined, 1);
    renderer.update(DEFAULT_EPOCH_JD);
    const start = renderer.members[0].marker.quaternion.clone();
    renderer.update(DEFAULT_EPOCH_JD + 40);

    expect(renderer.members[0].marker.quaternion.angleTo(start)).toBe(0);
  });
});

describe('exoplanet size without a measured radius', () => {
  const radiusOf = (overrides: Partial<ExoplanetRecord>): number => {
    const renderer = new SystemOrbitsRenderer([], [exoplanet(overrides)], undefined, 1);
    return ((renderer.members[0].marker as THREE.Mesh).geometry as THREE.SphereGeometry).parameters.radius;
  };
  const EARTH_AU = 6371 / 149597870.7;

  it('draws a giant known only by its mass at about Jupiter’s size, not at an Earth', () => {
    // 14 Her b: 2 829 Earth masses, no radius. It used to come out the size of the Earth.
    expect(radiusOf({ radiusEarth: undefined, massEarth: 2829 }) / EARTH_AU).toBeCloseTo(11.2, 1);
  });

  it('keeps a measured radius over any estimate', () => {
    expect(radiusOf({ radiusEarth: 1.88, massEarth: 2829 }) / EARTH_AU).toBeCloseTo(1.88, 2);
  });
});

describe('solar-system bodies against Horizons', () => {
  // Real records from bodies.json, and Horizons' own positions for them (ICRF, AU; heliocentric
  // for the planets, planet-centred for the moons) at dates across 1950-2100, so the whole path —
  // mean elements, their rates, the Laplace planes and the scene's frame — is checked against
  // JPL's ephemeris rather than against itself.
  const RECORDS: Record<string, Pick<BodyRecord, 'kind' | 'orbit' | 'rates' | 'laplacePole' | 'parentBodyId' | 'massRatio'>> = {
    earth: {kind: 'planet', orbit: {semiMajorAxisAu: 1.00000018, eccentricity: 0.01673163, inclinationDeg: -0.00054346, longitudeOfAscendingNodeDeg: -5.11260389, argumentOfPeriapsisDeg: 108.04266274, meanAnomalyAtEpochDeg: -2.4631431299999917, epochJd: 2451545}, rates: {meanMotionDegPerDay: 0.9856091187759068, longitudeOfAscendingNodeDegPerDay: -0.000006604751813826146, argumentOfPeriapsisDegPerDay: 0.000015309819575633124, semiMajorAxisAuPerDay: -8.213552361396303e-13, eccentricityPerDay: -1.002327173169062e-9, inclinationDegPerDay: -3.6609938398357287e-7}},
    jupiter: {kind: 'planet', orbit: {semiMajorAxisAu: 5.20248019, eccentricity: 0.0485359, inclinationDeg: 1.29861416, longitudeOfAscendingNodeDeg: 100.29282654, argumentOfPeriapsisDeg: -86.0178741, meanAnomalyAtEpochDeg: 20.059839080000003, epochJd: 2451545}, rates: {meanMotionDegPerDay: 0.08309113532019165, longitudeOfAscendingNodeDegPerDay: 0.0000035659463381245725, argumentOfPeriapsisDegPerDay: 0.0000014167219712525667, semiMajorAxisAuPerDay: -7.841204654346339e-10, eccentricityPerDay: 4.935249828884326e-9, inclinationDegPerDay: -8.83501711156742e-8, meanAnomalyTerms: {b: -0.00012452, c: 0.0606406, s: -0.35635438, f: 38.35125}}},
    saturn: {kind: 'planet', orbit: {semiMajorAxisAu: 9.54149883, eccentricity: 0.05550825, inclinationDeg: 2.49424102, longitudeOfAscendingNodeDeg: 113.63998702, argumentOfPeriapsisDeg: -20.778626390000014, meanAnomalyAtEpochDeg: -42.78564733999999, epochJd: 2451545}, rates: {meanMotionDegPerDay: 0.033459683702669406, longitudeOfAscendingNodeDegPerDay: -0.000006848734291581108, argumentOfPeriapsisDegPerDay: 0.000021682266940451745, semiMajorAxisAuPerDay: -8.391512662559891e-10, eccentricityPerDay: -8.773169062286106e-9, inclinationDegPerDay: 1.2374236824093085e-7, meanAnomalyTerms: {b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125}}},
    neptune: {kind: 'planet', orbit: {semiMajorAxisAu: 30.06952752, eccentricity: 0.00895439, inclinationDeg: 1.7700552, longitudeOfAscendingNodeDeg: 131.78635853, argumentOfPeriapsisDeg: -85.10477129, meanAnomalyAtEpochDeg: 257.54130563, epochJd: 2451545}, rates: {meanMotionDegPerDay: 0.005981249914852841, longitudeOfAscendingNodeDegPerDay: -1.6599644079397672e-7, argumentOfPeriapsisDegPerDay: 4.4250239561943875e-7, semiMajorAxisAuPerDay: 1.7650924024640657e-9, eccentricityPerDay: 2.2395619438740589e-10, inclinationDegPerDay: 6.132785763175907e-9, meanAnomalyTerms: {b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025}}},
    pluto: {kind: 'dwarf', orbit: {semiMajorAxisAu: 39.48686035, eccentricity: 0.24885238, inclinationDeg: 17.1410426, longitudeOfAscendingNodeDeg: 110.30167986, argumentOfPeriapsisDeg: 113.79534612000002, meanAnomalyAtEpochDeg: 14.86832412999999, epochJd: 2451545}, rates: {meanMotionDegPerDay: 0.003974823518959616, longitudeOfAscendingNodeDegPerDay: -2.2176071184120468e-7, argumentOfPeriapsisDegPerDay: -4.3489664613278575e-8, semiMajorAxisAuPerDay: 1.2313511293634495e-7, eccentricityPerDay: 1.6470910335386722e-9, inclinationDegPerDay: 1.3716632443531827e-10, meanAnomalyTerms: {b: -0.01262724, c: 0, s: 0, f: 0}}},
    moon: {kind: 'moon', orbit: {semiMajorAxisAu: 0.0025695552897999907, eccentricity: 0.0554, inclinationDeg: 5.16, longitudeOfAscendingNodeDeg: 125.08, argumentOfPeriapsisDeg: 318.15, meanAnomalyAtEpochDeg: 135.27, epochJd: 2451545}, rates: {meanMotionDegPerDay: 13.176358, longitudeOfAscendingNodeDegPerDay: -0.052990660396105185, argumentOfPeriapsisDegPerDay: 0.164353223839846}, parentBodyId: 'earth'},
    io: {kind: 'moon', orbit: {semiMajorAxisAu: 0.0028195588481728304, eccentricity: 0.0041, inclinationDeg: 0.036, longitudeOfAscendingNodeDeg: 43.977, argumentOfPeriapsisDeg: 84.129, meanAnomalyAtEpochDeg: 342.021, epochJd: 2450464.5}, rates: {meanMotionDegPerDay: 203.4889583, longitudeOfAscendingNodeDegPerDay: -0.1328337309120696, argumentOfPeriapsisDegPerDay: -0.6065392513031117}, laplacePole: {raDeg: 268.057, decDeg: 64.495}, parentBodyId: 'jupiter'},
    europa: {kind: 'moon', orbit: {semiMajorAxisAu: 0.004486026417754354, eccentricity: 0.0094, inclinationDeg: 0.466, longitudeOfAscendingNodeDeg: 219.106, argumentOfPeriapsisDeg: 88.97, meanAnomalyAtEpochDeg: 171.016, epochJd: 2450464.5}, rates: {meanMotionDegPerDay: 101.3747242, longitudeOfAscendingNodeDegPerDay: -0.03265393199600969, argumentOfPeriapsisDegPerDay: -0.7070489837643877}, laplacePole: {raDeg: 268.084, decDeg: 64.506}, parentBodyId: 'jupiter'},
    titan: {kind: 'moon', orbit: {semiMajorAxisAu: 0.008167663044150534, eccentricity: 0.0288, inclinationDeg: 0.306, longitudeOfAscendingNodeDeg: 28.06, argumentOfPeriapsisDeg: 180.532, meanAnomalyAtEpochDeg: 163.31, epochJd: 2451545}, rates: {meanMotionDegPerDay: 22.5769756, longitudeOfAscendingNodeDegPerDay: -0.001398845136769169, argumentOfPeriapsisDegPerDay: 0.002799120423059061}, laplacePole: {raDeg: 36.214, decDeg: 83.949}, parentBodyId: 'saturn'},
    triton: {kind: 'moon', orbit: {semiMajorAxisAu: 0.002371417442908832, eccentricity: 0, inclinationDeg: 156.865, longitudeOfAscendingNodeDeg: 177.608, argumentOfPeriapsisDeg: 66.142, meanAnomalyAtEpochDeg: 352.257, epochJd: 2451545}, rates: {meanMotionDegPerDay: 61.2572638, longitudeOfAscendingNodeDegPerDay: 0.001433750844964632, argumentOfPeriapsisDegPerDay: 0.0025509841146658433}, laplacePole: {raDeg: 299.456, decDeg: 43.414}, parentBodyId: 'neptune'},
    uranus: {kind: 'planet', orbit: {semiMajorAxisAu: 19.18797948, eccentricity: 0.0468574, inclinationDeg: 0.77298127, longitudeOfAscendingNodeDeg: 73.96250215, argumentOfPeriapsisDeg: 98.47154226, meanAnomalyAtEpochDeg: 141.76872184, epochJd: 2451545}, rates: {meanMotionDegPerDay: 0.011731557178644764, longitudeOfAscendingNodeDegPerDay: 0.0000015714439425051334, argumentOfPeriapsisDegPerDay: 9.65718275154004e-7, semiMajorAxisAuPerDay: -5.600273785078713e-9, eccentricityPerDay: -4.2436687200547574e-10, inclinationDegPerDay: -4.932375085557837e-8, meanAnomalyTerms: {b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025}}},
    titania: {kind: 'moon', orbit: {semiMajorAxisAu: 0.002916485361445723, eccentricity: 0.0011, inclinationDeg: 0.079, longitudeOfAscendingNodeDeg: 279.771, argumentOfPeriapsisDeg: 284.4, meanAnomalyAtEpochDeg: 24.614, epochJd: 2444239.5}, rates: {meanMotionDegPerDay: 41.3514246, longitudeOfAscendingNodeDegPerDay: -0.005044947168524978, argumentOfPeriapsisDegPerDay: 0.006102004540272753}, laplacePole: {raDeg: 77.311, decDeg: 15.175}, parentBodyId: 'uranus'},
    charon: {kind: 'moon', orbit: {semiMajorAxisAu: 0.00013095774631236113, eccentricity: 0.0002, inclinationDeg: 0.08, longitudeOfAscendingNodeDeg: 26.928, argumentOfPeriapsisDeg: 146.106, meanAnomalyAtEpochDeg: 131.07, epochJd: 2451545}, rates: {meanMotionDegPerDay: 56.362521, longitudeOfAscendingNodeDegPerDay: -0.00010926638529337138, argumentOfPeriapsisDegPerDay: 0.00009683851540842405}, laplacePole: {raDeg: 132.993, decDeg: -6.163}, parentBodyId: 'pluto', massRatio: 0.1220485755631374},
  };
  // Each ceiling sits just above what these elements measure on that date: Earth 0.003 degrees,
  // Jupiter 0.063, Saturn 0.164, Pluto 0.054, the Moon 0.72 (no mean ellipse has its evection or
  // variation), Io 0.021, Europa 0.036, Titan 0.014, Triton 0.137, Titania 0.62 (against Uranus's
  // equator, 120 years from its 1980 epoch), Charon 0.37.
  const HORIZONS: Array<[id: string, jd: number, x: number, y: number, z: number, maxDeg: number]> = [
    ['earth', 2488069.5, -0.1574071329883954, 0.890666220858489, 0.3859132211165683, 0.02],
    ['jupiter', 2433282.5, 3.406605247558555, -3.425997624196318, -1.551719750032203, 0.1],
    ['saturn', 2478938.5, -3.51309768447752, -8.723317933082274, -3.452662390556131, 0.25],
    ['pluto', 2442413.5, -29.2488165026956, -7.1421817246801, 6.58403957591589, 0.1],
    ['moon', 2469807.5, 0.00240364781322315, 0.0006554283236619424, 0.0004472719300783614, 2],
    ['io', 2433282.5, 0.0004488349204269952, 0.002519633434577752, 0.00120678715190893, 0.05],
    ['europa', 2433282.5, 0.004084372287322533, -0.001665375585011311, -0.0007673072324795899, 0.1],
    ['titan', 2488069.5, 0.007800850235156121, -0.001556932380983438, -0.0006078959246502567, 0.05],
    ['triton', 2488069.5, -0.001421151845853369, -0.0001894510477241482, 0.001888790702926415, 0.2],
    ['titania', 2488069.5, -0.00151919968294745, -0.0003387914082135071, 0.002465657830788125, 0.75],
    ['charon', 2488069.5, -0.00003046411046017432, -0.000009404114448552256, 0.0001270457155789907, 0.5],
  ];

  function record(id: string): BodyRecord {
    return { id, systemStarId: 0, name: id, radiusKm: 1000, orbitSource: 'test', ...RECORDS[id] };
  }

  const renderer = new SystemOrbitsRenderer(Object.keys(RECORDS).map(record), []);

  for (const [id, jd, x, y, z, maxDeg] of HORIZONS) {
    it(`puts ${id} within ${maxDeg} degrees of Horizons on JD ${jd}`, () => {
      renderer.update(jd);
      const drawn = renderer.members.find((member) => member.id === id)!.marker.position;
      const angleDeg = (drawn.angleTo(new THREE.Vector3(x, y, z)) * 180) / Math.PI;
      expect(angleDeg).toBeLessThan(maxDeg);
    });
  }

  it('puts Pluto where Horizons has it round its barycentre with Charon, 2 131 km out and opposite Charon', () => {
    // Horizons, Pluto (999) from the Pluto-system barycentre (9), on JD 2488069.5 (2100).
    const horizons = new THREE.Vector3(0.000003313612032581019, 0.000001023040948538272, -0.00001381793390079716);
    renderer.update(2488069.5);
    const charon = renderer.members.find((member) => member.id === 'charon')!.marker;
    const barycentre = charon.parent!.position;
    const pluto = renderer.members.find((member) => member.id === 'pluto')!.marker.position.clone().sub(barycentre);
    const charonFromBarycentre = charon.position;

    expect((pluto.angleTo(horizons) * 180) / Math.PI).toBeLessThan(0.5);
    expect(pluto.length() * 149597870.7).toBeCloseTo(horizons.length() * 149597870.7, -1);
    // Opposite, at the inverse of their mass ratio.
    expect((pluto.angleTo(charonFromBarycentre) * 180) / Math.PI).toBeCloseTo(180, 6);
    expect(charonFromBarycentre.length() / pluto.length()).toBeCloseTo(1 / 0.1220485755631374, 6);
  });

  it('draws Pluto’s own orbit round the barycentre, in the plane it is going round in', () => {
    const charon = renderer.members.find((member) => member.id === 'charon')!.marker;
    const [charonLine, plutoLine] = charon.parent!.children.filter((child) => child.name === 'orbit-line');
    for (const days of [0, 3000, 30000]) {
      renderer.update(DEFAULT_EPOCH_JD + days);
      const pluto = renderer.members.find((member) => member.id === 'pluto')!.marker.position.clone().sub(charon.parent!.position);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plutoLine.quaternion);
      expect(Math.abs(pluto.clone().normalize().dot(normal))).toBeLessThan(1e-9);
      // A near-circle 2 131 km across, a ninth of Charon's.
      expect(Math.abs(plutoLine.scale.x) * 0.00013095774631236113).toBeCloseTo(pluto.length(), 8);
      expect(charonLine.scale.x / Math.abs(plutoLine.scale.x)).toBeCloseTo(1 / 0.1220485755631374, 9);
    }
  });

  it('turns the Moon’s drawn orbit with its node, so the Moon stays on its own line', () => {
    // Half the node's 18.6-year turn on, the ellipse drawn at the epoch has the Moon 10 degrees off
    // its plane at the worst.
    const moon = renderer.members.find((member) => member.id === 'moon')!.marker;
    const line = moon.parent!.children.find((child) => child.name === 'orbit-line')!;
    for (const days of [0, 1700, 3397, 3400]) {
      renderer.update(DEFAULT_EPOCH_JD + days);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(line.quaternion);
      expect(Math.abs(moon.position.clone().normalize().dot(normal))).toBeLessThan(1e-9);
    }
  });
});
