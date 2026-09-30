/// <reference types="node" />

import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_EPOCH_JD, GM_SUN_AU3_PER_DAY2, ttMinusUtSeconds } from '../../shared/astro/constants';
import { keplerRates } from '../../shared/astro/kepler';
import { eclipticToEquatorial, laplacePlaneToEquatorial, OBLIQUITY_J2000_DEG } from '../../shared/astro/coordinates';
import { orientationAt } from '../../shared/astro/rotational-elements';
import { BodyRecord } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { SystemOrbitsRenderer } from './system-orbits-renderer';
import { bodyTexturePath, loadCachedTexture } from '../../shared/rendering/texture-catalog';
import { bodyMarkerRadiusAu } from './system-framing';

/** The clock's UT date that names a TDB one: TT - UT, which moves by under a second a year, earlier. */
const utOf = (jdTdb: number): number => jdTdb - ttMinusUtSeconds(jdTdb) / 86400;

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
      // The clock's UT date whose TDB is the elements' epoch.
      renderer.update(utOf(DEFAULT_EPOCH_JD));

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

describe('rotation without IAU elements', () => {
  /** A body with a day of 23.934 h and no pole: Eris, Haumea and Makemake are drawn this way. */
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

  it('turns it about its orbit’s normal, backwards for a negative period', () => {
    expect(spinSense(spinning({ rotationPeriodHours: -23.934 }))).toBeLessThan(-0.99);
    expect(spinSense(spinning({ rotationPeriodHours: 23.934 }))).toBeGreaterThan(0.99);
  });

  it('turns Nereid, as shipped, once in the 11.594 hours Kepler measured: a sixth of a turn in 1.93 hours', () => {
    const shipped: BodyRecord[] = JSON.parse(readFileSync(`${process.cwd()}/src/assets/data/bodies.json`, 'utf8'));
    const renderer = new SystemOrbitsRenderer(shipped.filter((body) => body.id === 'neptune' || body.id === 'nereid'), []);
    const nereid = renderer.members.find((member) => member.id === 'nereid')!.marker;
    renderer.update(DEFAULT_EPOCH_JD);
    const start = nereid.quaternion.clone();
    renderer.update(DEFAULT_EPOCH_JD + 11.594 / 6 / 24);
    expect((nereid.quaternion.angleTo(start) * 180) / Math.PI).toBeCloseTo(60, 1);
  });

  it('leaves a body with no published rotation still', () => {
    // Hyperion, which tumbles: an invented period would be a claim.
    const renderer = new SystemOrbitsRenderer([spinning({ rotationPeriodHours: undefined })], [], undefined, 1);
    renderer.update(DEFAULT_EPOCH_JD);
    const start = renderer.members[0].marker.quaternion.clone();
    renderer.update(DEFAULT_EPOCH_JD + 40);

    expect(renderer.members[0].marker.quaternion.angleTo(start)).toBe(0);
  });
});

describe('outermostRadiusAu', () => {
  function drawn(axis: number, eccentricity: number): BodyRecord {
    return {
      id: 'eris', systemStarId: 0, name: 'Eris', kind: 'dwarf', radiusKm: 1163, orbitSource: 'test',
      orbit: { semiMajorAxisAu: axis, eccentricity, inclinationDeg: 44, longitudeOfAscendingNodeDeg: 36, argumentOfPeriapsisDeg: 151, meanAnomalyAtEpochDeg: 0, epochJd: DEFAULT_EPOCH_JD },
      rates: keplerRates(axis, GM_SUN_AU3_PER_DAY2)
    };
  }

  it('reaches as far as an eccentric orbit goes past the grid: Eris’s aphelion, 97.7 AU, not the 80 AU ring', () => {
    const renderer = new SystemOrbitsRenderer([drawn(67.934, 0.4382)], []);
    expect(renderer.outermostRadiusAu).toBeCloseTo(67.934 * 1.4382, 9);
    renderer.dispose();
  });

  it('reaches an exoplanet’s aphelion too: HD 20782 b’s, 1.66 times its 1.6 AU ring', () => {
    // The most eccentric of the 303 exoplanet systems with an orbit past their ring, counted on
    // exoplanets.json (a = 1.3649 AU, e = 0.95).
    const renderer = new SystemOrbitsRenderer([], [exoplanet({ id: 'HD 20782 b', name: 'HD 20782 b', orbit: { semiMajorAxisAu: 1.3649, eccentricity: 0.95 } })]);
    expect(renderer.outermostRadiusAu).toBeCloseTo(1.3649 * 1.95, 9);
    renderer.dispose();
  });

  it('is the grid’s outer ring where every orbit stays inside it', () => {
    const renderer = new SystemOrbitsRenderer([drawn(30, 0.01)], []);
    expect(renderer.outermostRadiusAu).toBe(35);
    renderer.dispose();
  });
});

describe('photographs', () => {
  it('puts them on their bodies once loaded, one a frame, so the GPU is not handed every map at once, and in their own colours', () => {
    // Ids no other test here draws, since the loaded textures are shared through the cache.
    const ids = ['ganymede', 'callisto'];
    const records: BodyRecord[] = ids.map((id, index) => ({
      id, systemStarId: 0, name: id, kind: 'planet', radiusKm: 2500, orbitSource: 'test',
      orbit: { semiMajorAxisAu: 1 + index, eccentricity: 0, inclinationDeg: 0, longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0, epochJd: DEFAULT_EPOCH_JD },
      rates: keplerRates(1 + index, GM_SUN_AU3_PER_DAY2)
    }));
    const renderer = new SystemOrbitsRenderer(records, []);
    const materials = (): THREE.MeshStandardMaterial[] => renderer.members.map((member) => (member.marker as THREE.Mesh).material as THREE.MeshStandardMaterial);
    const maps = (): Array<THREE.Texture | null> => materials().map((material) => material.map);
    const colours = (): number[] => materials().map((material) => material.color.getHex());

    renderer.update(DEFAULT_EPOCH_JD);
    expect(maps()).toEqual([null, null]); // not loaded yet: jsdom never loads an image
    // Until then each is its kind's flat colour, a planet's pale blue.
    expect(colours()).toEqual([new THREE.Color(0.55, 0.75, 1).getHex(), new THREE.Color(0.55, 0.75, 1).getHex()]);

    for (const id of ids) {
      loadCachedTexture(bodyTexturePath(id)!).image = { width: 2, height: 1 };
    }
    renderer.update(DEFAULT_EPOCH_JD);
    expect(maps().filter(Boolean)).toHaveLength(1);
    renderer.update(DEFAULT_EPOCH_JD);
    expect(maps()).toEqual(ids.map((id) => loadCachedTexture(bodyTexturePath(id)!)));
    // The material multiplies its map by its colour: left pale blue, every planet's photograph would
    // be tinted, Mars's red cut by 45 per cent.
    expect(colours()).toEqual([0xffffff, 0xffffff]);
    renderer.dispose();
  });
});

describe('markers', () => {
  it('draws every body on the one sphere, scaled to its radius, and leaves that sphere when a system is left', () => {
    const records: BodyRecord[] = [2500, 60000].map((radiusKm, index) => ({
      id: `body-${index}`, systemStarId: 0, name: `Body ${index}`, kind: 'planet', radiusKm, orbitSource: 'test',
      orbit: { semiMajorAxisAu: 1 + index, eccentricity: 0, inclinationDeg: 0, longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0, epochJd: DEFAULT_EPOCH_JD },
      rates: keplerRates(1 + index, GM_SUN_AU3_PER_DAY2)
    }));
    const renderer = new SystemOrbitsRenderer(records, [exoplanet({ radiusEarth: 1.1 })], undefined, 1);
    const meshes = renderer.members.map((member) => member.marker as THREE.Mesh);
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(1);
    [2500, 60000, 1.1 * 6371].forEach((radiusKm, index) => {
      const sphere = meshes[index].geometry as THREE.SphereGeometry;
      expect(meshes[index].scale.x * sphere.parameters.radius).toBeCloseTo(bodyMarkerRadiusAu(radiusKm), 12);
    });
    const disposed = vi.fn();
    meshes[0].geometry.addEventListener('dispose', disposed);
    renderer.dispose();
    expect(disposed).not.toHaveBeenCalled();
  });
});

describe('derived surfaces', () => {
  const maps = (renderer: SystemOrbitsRenderer): Array<THREE.Texture | null> =>
    renderer.members.map((member) => ((member.marker as THREE.Mesh).material as THREE.MeshStandardMaterial).map);
  const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const twoPlanets = (): SystemOrbitsRenderer =>
    new SystemOrbitsRenderer([], [exoplanet({ radiusEarth: 1.1 }), exoplanet({ id: 'TRAPPIST-1 c', name: 'TRAPPIST-1 c', radiusEarth: 1.0 })], undefined, 1);

  it('paints them after the system is built, one a task, so entering a system is not held up, and in their own colours', async () => {
    const colours = (renderer: SystemOrbitsRenderer): number[] =>
      renderer.members.map((member) => ((member.marker as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex());
    const renderer = twoPlanets();
    expect(maps(renderer)).toEqual([null, null]);
    // Until then each is its kind's flat colour, an exoplanet's magenta.
    expect(colours(renderer)).toEqual([new THREE.Color(0.85, 0.4, 0.85).getHex(), new THREE.Color(0.85, 0.4, 0.85).getHex()]);
    await nextTask();
    expect(maps(renderer).filter(Boolean)).toHaveLength(1);
    await nextTask();
    expect(maps(renderer).every(Boolean)).toBe(true);
    // Left magenta, every derived surface would be multiplied by it, its green cut by 60 per cent.
    expect(colours(renderer)).toEqual([0xffffff, 0xffffff]);
    renderer.dispose();
  });

  it('builds a body still waiting for its surface without three warning of an undefined map', () => {
    const warn = vi.spyOn(console, 'warn');
    twoPlanets().dispose();
    expect(warn.mock.calls.flat().join(' ')).not.toContain("parameter 'map'");
    warn.mockRestore();
  });

  it('paints nothing once the system is left', async () => {
    const renderer = twoPlanets();
    renderer.dispose();
    await nextTask();
    expect(maps(renderer)).toEqual([null, null]);
  });
});

describe('exoplanet size without a measured radius', () => {
  const radiusOf = (overrides: Partial<ExoplanetRecord>): number => {
    const renderer = new SystemOrbitsRenderer([], [exoplanet(overrides)], undefined, 1);
    return renderer.members[0].marker.userData['radiusAu'];
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
  // The records the app ships, read from bodies.json with their IAU rotational elements, and
  // Horizons' own positions for them (ICRF, AU; heliocentric for the planets, planet-centred for the
  // moons) at dates across 1950-2100, so the whole path — the ETL's reading of the mean elements,
  // their rates, the Laplace planes and the scene's frame — is checked against JPL's ephemeris rather
  // than against itself. A hand copy of the records stood here, and an ETL that dropped Standish's a,
  // e and i rates or Io's and Europa's backward periapses passed the whole suite on the data it
  // wrote. Horizons' dates are TDB and the renderer's are the clock's UT, so each is handed over
  // TT - UT earlier: 69.184 s today, 29 in 1950.
  const SHIPPED: BodyRecord[] = JSON.parse(readFileSync(`${process.cwd()}/src/assets/data/bodies.json`, 'utf8'));
  // Mimas and Phobos among them for the terms of their IAU W that are motion along the orbit: the
  // Mimas-Tethys libration and Phobos's tidal acceleration (see `orbitalTermsOfPrimeMeridian`).
  const IDS = ['earth', 'jupiter', 'saturn', 'neptune', 'pluto', 'moon', 'io', 'europa', 'titan', 'triton', 'uranus', 'titania', 'charon', 'venus', 'mars', 'mimas', 'phobos'];
  // Each ceiling sits just above what these elements measure on that date: Earth 0.003 degrees,
  // Jupiter 0.063, Saturn 0.164, Pluto 0.054, the Moon 0.72 (no mean ellipse has its evection or
  // variation), Io 0.021, Europa 0.036, Titan 0.014, Triton 0.137, Titania 0.62 (against Uranus's
  // equator, 120 years from its 1980 epoch), Charon 0.37, Mimas 2.24 on 2026 May 27, when its libration has it
  // 44 degrees ahead of its mean motion (43.3 without the term), and Phobos 1.25 in 2100 (11.1 without its
  // tidal acceleration).
  const HORIZONS: Array<[id: string, jd: number, x: number, y: number, z: number, maxDeg: number]> = [
    ['earth', 2488069.5, -0.1574071329883954, 0.890666220858489, 0.3859132211165683, 0.02],
    // AD 3000, the end of the clock's window and of Standish's fit: the Earth-Moon barycentre and
    // Saturn's, 0.005 and 0.065 degrees out. Without Standish's rates for a, e and i they were 0.129
    // and 0.412, which no date between 1950 and 2100 shows (at most 0.036, Saturn in 2100).
    ['earth', 2816787.5, 0.06574092668156256, 0.9022934196570718, 0.3887693148519465, 0.02],
    ['saturn', 2816787.5, 8.434780522117482, 3.87565654130078, 1.235068259814154, 0.1],
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
    ['mimas', 2461187.5, -3.840685116962088e-4, 1.182766232573268e-3, -2.006928678577268e-5, 3],
    ['phobos', 2488069.5, 4.269855297288105e-5, -2.759158950396543e-5, -3.816269137755616e-5, 1.5],
  ];

  function record(id: string): BodyRecord {
    const { kind, orbit, rates, laplacePole, parentBodyId, massRatio, rotationalElements } = SHIPPED.find((body) => body.id === id)!;
    return { id, systemStarId: 0, name: id, radiusKm: 1000, orbitSource: 'test', kind, orbit, rates, laplacePole, parentBodyId, massRatio, rotationalElements };
  }

  const renderer = new SystemOrbitsRenderer(IDS.map(record), []);

  for (const [id, jd, x, y, z, maxDeg] of HORIZONS) {
    it(`puts ${id} within ${maxDeg} degrees of Horizons on JD ${jd}`, () => {
      renderer.update(utOf(jd));
      const drawn = renderer.members.find((member) => member.id === id)!.marker.position;
      const angleDeg = (drawn.angleTo(new THREE.Vector3(x, y, z)) * 180) / Math.PI;
      expect(angleDeg).toBeLessThan(maxDeg);
    });
  }

  it('puts Pluto where Horizons has it round its barycentre with Charon, 2 131 km out and opposite Charon', () => {
    // Horizons, Pluto (999) from the Pluto-system barycentre (9), on JD 2488069.5 TDB (2100).
    const horizons = new THREE.Vector3(0.000003313612032581019, 0.000001023040948538272, -0.00001381793390079716);
    renderer.update(utOf(2488069.5));
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

  it('turns a planet’s drawn orbit with its node, so Mars stays on its own line two thousand years out', () => {
    // At AD 1 a line fixed at J2000 has Mars 3.3 million km from it, 0.5 million out of its plane.
    const mars = renderer.members.find((member) => member.id === 'mars')!.marker;
    const line = renderer.object.children[renderer.object.children.indexOf(mars) - 1];
    expect(line.name).toBe('orbit-line');
    for (const days of [0, -730000]) {
      renderer.update(DEFAULT_EPOCH_JD + days);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(line.quaternion);
      expect(Math.abs(mars.position.clone().normalize().dot(normal))).toBeLessThan(1e-9);
    }
  });

  /** How far a top-level body is from its own drawn orbit line, in AU: from the nearest of its chords. */
  function offLineAu(id: string): number {
    const marker = renderer.members.find((member) => member.id === id)!.marker;
    const line = renderer.object.children[renderer.object.children.indexOf(marker) - 1] as THREE.Line;
    expect(line.name).toBe('orbit-line');
    line.updateMatrixWorld();
    const position = line.geometry.getAttribute('position');
    const vertex = (index: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(line.matrixWorld);
    const chord = new THREE.Line3();
    const closest = new THREE.Vector3();
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < position.count; index++) {
      nearest = Math.min(nearest, chord.set(vertex(index), vertex(index + 1)).closestPointToPoint(marker.position, true, closest).distanceTo(marker.position));
    }
    return nearest;
  }

  it('redraws a planet’s orbit as its axis and eccentricity drift, so Saturn and Mars stay on their lines at AD 1', () => {
    // What is left is the 128 chords' own sag from the true ellipse, which depends on where the
    // planet falls between two points: at most 0.0032 AU for Saturn, near aphelion, and 0.00055 for
    // Mars. Measured 0.0017 AU for Saturn and 0.0005 for Mars at AD 1, and 0.0011 for Saturn at
    // J2000. Drawn at J2000's shape at AD 1, the lines were 0.054 AU from Saturn and 0.0022 from Mars.
    const saturnLine = renderer.object.children[renderer.object.children.indexOf(renderer.members.find((member) => member.id === 'saturn')!.marker) - 1] as THREE.Line;
    renderer.update(DEFAULT_EPOCH_JD);
    const drawnVersion = (saturnLine.geometry.getAttribute('position') as THREE.BufferAttribute).version;
    for (const [id, days, maxAu] of [['saturn', -730000, 0.0035], ['mars', -730000, 0.0006], ['saturn', 0, 0.0035]] as const) {
      renderer.update(DEFAULT_EPOCH_JD + days);
      expect(offLineAu(id)).toBeLessThan(maxAu);
      if (days !== 0) {
        // Handed to the GPU again, which uploads a buffer only when its version rises: the points
        // rewritten on the CPU alone leave J2000's ellipse on screen.
        expect((saturnLine.geometry.getAttribute('position') as THREE.BufferAttribute).version).toBeGreaterThan(drawnVersion);
      }
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

  const JUNE_1_2025_NOON_UTC = 2460828.0;

  /**
   * The tilt of a body's drawn spin from the orbit it is drawn going round, in degrees: its angular
   * velocity, read off the sphere a quarter of an hour apart, against its orbit line's normal. Past
   * 90 is a body turning backwards against its orbit.
   */
  function drawnObliquity(id: string): number {
    const marker = renderer.members.find((member) => member.id === id)!.marker;
    const line = renderer.object.children[renderer.object.children.indexOf(marker) - 1];
    expect(line.name).toBe('orbit-line');
    renderer.update(JUNE_1_2025_NOON_UTC);
    const start = marker.quaternion.clone();
    renderer.update(JUNE_1_2025_NOON_UTC + 0.01);
    const turn = marker.quaternion.clone().multiply(start.invert());
    const spin = new THREE.Vector3(turn.x, turn.y, turn.z).multiplyScalar(Math.sign(turn.w));
    return (spin.angleTo(new THREE.Vector3(0, 0, 1).applyQuaternion(line.quaternion)) * 180) / Math.PI;
  }

  it('turns Venus, Uranus and Pluto backwards against their orbits, at the tilts Horizons gives the first two', () => {
    // Pluto's Horizons page gives no tilt; 119.6 is the one its IAU pole makes with its orbit, so for
    // Pluto this checks that its pole and W are drawn as the kernel gives them, not the pole itself.
    // The IAU names a planet's north pole by the side of the solar system it lies on, so Venus's W
    // and Uranus's run backwards; Pluto's pole follows the right-hand rule instead, and points
    // south. Either way the spin read off the drawn sphere is past 90 degrees from the orbit's pole.
    expect(drawnObliquity('venus')).toBeCloseTo(177.3, 0);
    expect(drawnObliquity('uranus')).toBeCloseTo(97.77, 0);
    expect(drawnObliquity('pluto')).toBeCloseTo(119.6, 0);
    expect(drawnObliquity('earth')).toBeCloseTo(23.44, 0);
  });

  /**
   * Where on its drawn sphere a body faces a point, as east longitude and latitude on its map: read
   * from the texture coordinates where a ray from that point meets the sphere, so the map's own
   * convention is part of what is measured.
   */
  function facing(id: string, point: THREE.Vector3): { eastDeg: number; latDeg: number } {
    const marker = renderer.members.find((member) => member.id === id)!.marker as THREE.Mesh;
    const centre = worldPosition(id);
    const towards = point.clone().sub(centre).normalize();
    const radius = marker.userData['radiusAu'];
    const hit = new THREE.Raycaster(centre.clone().addScaledVector(towards, radius * 4), towards.clone().negate()).intersectObject(marker)[0];
    return { eastDeg: (hit.uv!.x - 0.5) * 360, latDeg: (hit.uv!.y - 0.5) * 180 };
  }

  function worldPosition(id: string): THREE.Vector3 {
    const marker = renderer.members.find((member) => member.id === id)!.marker;
    marker.updateWorldMatrix(true, false);
    return marker.getWorldPosition(new THREE.Vector3());
  }

  /** Degrees between two longitudes, the short way round. */
  const apart = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

  /** Where the IAU puts a body's prime meridian at a TDB date, in the scene. */
  function iauPrimeMeridian(id: string, jdTdb: number): THREE.Vector3 {
    const { poleRaDeg, poleDecDeg, primeMeridianDeg } = orientationAt(SHIPPED.find((body) => body.id === id)!.rotationalElements!, jdTdb);
    const w = (primeMeridianDeg * Math.PI) / 180;
    const meridian = laplacePlaneToEquatorial({ x: Math.cos(w), y: Math.sin(w), z: 0 }, { raDeg: poleRaDeg, decDeg: poleDecDeg });
    return new THREE.Vector3(meridian.x, meridian.y, meridian.z);
  }

  /** The drawn sphere's longitude 0 on its equator: +X of the sphere as `SphereGeometry` wraps its map. */
  function drawnPrimeMeridian(id: string): THREE.Vector3 {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(renderer.members.find((member) => member.id === id)!.marker.quaternion);
  }

  it('turns Jupiter at AD 1000 by its W at that date’s TT, 1 574 s after the UT the clock names', () => {
    // Espenak and Meeus's ΔT for JD 2086307.5, 1 January 1000 in the Julian calendar, where TT - UT was 23 times what it is today: held
    // at today's 69 s, Jupiter was drawn 15 degrees short of its W.
    const jdUt = 2086307.5;
    renderer.update(jdUt);
    expect((drawnPrimeMeridian('jupiter').angleTo(iauPrimeMeridian('jupiter', jdUt + 1574.1 / 86400)) * 180) / Math.PI).toBeLessThan(0.01);
  });

  it('turns Earth by the UT the clock names, which is its turning: at AD 1000 the Sun stands over Horizons’ point', () => {
    // Horizons' sub-solar longitude from the Sun (observer quantity 14, TIME_TYPE=UT) on JD 2086455,
    // 1.0510 E, is Earth as it was 8.454 minutes before. Turned by the IAU's W at UT + 69.184 s, as it
    // was, the drawn face was 2.3 degrees off (2.0 at UT itself); taken at TDB, which turns it ΔT
    // (6.6 degrees) further the same way, 8.6.
    renderer.update(2086455 - 8.45437443 / 1440);
    expect(apart(facing('earth', new THREE.Vector3()).eastDeg, 1.05101)).toBeLessThan(0.15);
  });

  it('lights Earth where the Sun really stands: within 4 degrees of Greenwich at noon UTC', () => {
    // The equation of time is all that separates them: on 1 June 2025 it puts the Sun over 0.53 W,
    // and the drawn sphere has it over 0.52 W.
    renderer.update(JUNE_1_2025_NOON_UTC);
    expect(Math.abs(facing('earth', new THREE.Vector3()).eastDeg)).toBeLessThan(4);
  });

  // Horizons' sub-Earth latitude on Saturn (observer quantity 14, from Earth's centre), which is
  // planetodetic: taken back to planetocentric through the flattening, it is the angle the rings are
  // opened to Earth by. Measured: 26.963, 0.075 and -7.764 degrees drawn, against 26.966, 0.042 and
  // -7.813.
  const SATURN_FLATTENING = 0.09796;
  const RING_OPENING: Array<[date: string, jd: number, planetodeticDeg: number]> = [
    ['16 October 2017, near their widest', 2458042.5, 32.017423],
    ['23 March 2025, as Earth crossed their plane', 2460757.5, 0.051359],
    ['24 September 2026, the south face turned to Earth', 2461307.5, -9.571756]
  ];

  const saturnRingMesh = (): THREE.Mesh => renderer.members.find((member) => member.id === 'saturn')!.marker.children[0] as THREE.Mesh;

  /** The ring's face normal in the scene, read off its own geometry rather than its transform. */
  function ringNormal(ring: THREE.Mesh): THREE.Vector3 {
    ring.updateWorldMatrix(true, false);
    return new THREE.Vector3().fromBufferAttribute(ring.geometry.attributes['normal'], 0).transformDirection(ring.matrixWorld);
  }

  for (const [date, jd, planetodeticDeg] of RING_OPENING) {
    it(`opens Saturn's rings to Earth as far as Horizons has them on ${date}`, () => {
      renderer.update(jd);
      const normal = ringNormal(saturnRingMesh());
      const toEarth = worldPosition('earth').sub(worldPosition('saturn')).normalize();
      const openingDeg = (Math.asin(normal.dot(toEarth)) * 180) / Math.PI;
      const expectedDeg = (Math.atan((1 - SATURN_FLATTENING) ** 2 * Math.tan((planetodeticDeg * Math.PI) / 180)) * 180) / Math.PI;
      expect(Math.abs(openingDeg - expectedDeg)).toBeLessThan(0.1);
    });
  }

  it('picks Saturn through its rings', () => {
    renderer.update(JUNE_1_2025_NOON_UTC);
    const ring = saturnRingMesh();
    const normal = ringNormal(ring);
    const inRingPlane = new THREE.Vector3().fromBufferAttribute(ring.geometry.attributes['position'], 0).transformDirection(ring.matrixWorld);
    // Straight down onto the B ring, 100 000 km out: nowhere near the planet itself.
    const onRing = worldPosition('saturn').addScaledVector(inRingPlane, 100000 / 149597870.7);
    const [hit] = new THREE.Raycaster(onRing.clone().addScaledVector(normal, 0.01), normal.clone().negate()).intersectObjects(renderer.pickableObjects);
    expect(hit.object).toBe(ring);
    expect(renderer.memberForObject(hit.object)?.id).toBe('saturn');
  });

  // Horizons' observer quantities 14 and 15 at 2025-06-01 12:00 UTC, from Earth's centre (from the
  // Sun's, for Earth): the sub-observer and sub-solar longitude and latitude, east-positive for
  // Earth and the Moon and west-positive for Mars and Jupiter, as each is printed. Horizons gives
  // each body as it was when the light now arriving left it, so it is drawn that much earlier. Its
  // latitudes are planetodetic, on the body's flattened figure, which a sphere does not have, so the
  // drawn latitude is put on that figure before they are compared: without it they differ by what
  // the flattening makes of them, 0.14 degrees on Earth, 0.26 on Mars and 0.33 on Jupiter.
  //
  // Measured: every longitude within 0.09 degrees and every latitude within 0.03, but for the
  // Moon's face towards Earth, 0.70 and 0.09 out because its mean orbit is (its evection alone is
  // 1.27 degrees); its face towards the Sun is within 0.002. Io's face towards Jupiter is 0.012 out:
  // with its orbit taken at the clock's UTC and its spin at TDB it was 0.175, the 69 s between them.
  const SUB_POINTS: Array<[id: string, observer: string | undefined, lightMinutes: number, west: boolean, flattening: number, observerLon: number, observerLat: number, sunLon: number, sunLat: number, maxObserverDeg: number]> = [
    ['earth', undefined, 8.43351424, false, 1 / 298.257, 1.5855, 22.261204, 1.579501, 22.260426, 0.1],
    ['mars', 'earth', 14.13295841, true, 1 - 3376.2 / 3396.19, 307.365389, 21.27653, 269.287887, 25.451264, 0.1],
    ['moon', 'earth', 0.02150549, false, 0, 7.256763, -3.462104, 116.285934, 1.503004, 0.8],
    ['jupiter', 'earth', 50.70337676, true, 1 - 66854 / 71492, 251.139846, 2.58787, 247.855871, 2.572658, 0.1],
    ['io', 'jupiter', 0.02340584, true, 0, 359.964094, -0.002537, 355.673108, 2.26528, 0.05]
  ];

  for (const [id, observer, lightMinutes, west, flattening, observerLon, observerLat, sunLon, sunLat, maxObserverDeg] of SUB_POINTS) {
    it(`faces ${observer ?? 'the Sun'} and the Sun with the points Horizons gives on ${id}`, () => {
      renderer.update(JUNE_1_2025_NOON_UTC - lightMinutes / 1440);
      const seen = facing(id, observer ? worldPosition(observer) : new THREE.Vector3());
      const lit = facing(id, new THREE.Vector3());
      const east = (longitude: number): number => (west ? -longitude : longitude);
      const planetodetic = (latDeg: number): number => (Math.atan(Math.tan((latDeg * Math.PI) / 180) / (1 - flattening) ** 2) * 180) / Math.PI;
      expect(apart(seen.eastDeg, east(observerLon))).toBeLessThan(maxObserverDeg);
      expect(Math.abs(planetodetic(seen.latDeg) - observerLat)).toBeLessThan(maxObserverDeg);
      expect(apart(lit.eastDeg, east(sunLon))).toBeLessThan(0.1);
      expect(Math.abs(planetodetic(lit.latDeg) - sunLat)).toBeLessThan(0.05);
    });
  }
});

describe('locked moons across the clock’s window', () => {
  // As shipped, pole, W and all: the IAU gives each a W fitted near the present, and its rate is
  // not quite its orbit's, nor Iapetus's pole a line for twenty centuries.
  const shipped: BodyRecord[] = JSON.parse(readFileSync(`${process.cwd()}/src/assets/data/bodies.json`, 'utf8'));
  const renderer = new SystemOrbitsRenderer(shipped.filter((body) => ['saturn', 'uranus', 'neptune', 'mimas', 'iapetus', 'miranda', 'proteus'].includes(body.id)), []);

  /** East longitude, on its map, of the point on a moon's drawn sphere that faces its planet. */
  function facingPlanet(id: string): number {
    const moon = renderer.members.find((member) => member.id === id)!.marker;
    // Its position is from the planet, which is its pivot; SphereGeometry wraps u = atan2(z, -x) / 2 pi.
    const toPlanet = moon.position.clone().negate().applyQuaternion(moon.quaternion.clone().invert());
    const u = Math.atan2(toPlanet.z, -toPlanet.x) / (2 * Math.PI);
    return ((((u - 0.5) * 360) % 360) + 540) % 360 - 180;
  }

  it('keeps Proteus, Miranda, Mimas and Iapetus facing their planets at AD 1 and AD 3000', () => {
    // Measured: Proteus 2.6 degrees at most over AD 1-3000, Miranda 2.4, Mimas 8.9, Iapetus 16 (9.4
    // of it the lag of the row its orbit is drawn from). On the IAU's own W and Iapetus's straight
    // pole they were 146, 23, 49 and 87 degrees at AD 1.
    for (const jd of [1721425.5, 2816787.4]) {
      renderer.update(jd);
      expect(Math.abs(facingPlanet('proteus'))).toBeLessThan(3);
      expect(Math.abs(facingPlanet('miranda'))).toBeLessThan(3);
      expect(Math.abs(facingPlanet('mimas'))).toBeLessThan(9.5);
      expect(Math.abs(facingPlanet('iapetus'))).toBeLessThan(16.5);
    }
  });

  it('keeps the axes of Miranda, Mimas and Iapetus on their drawn orbits’ normals, as a Cassini state holds them, at AD 1, today and AD 3000', () => {
    // Measured over AD 1-3000: Miranda 0.42 degrees at most, Mimas 0.47, Iapetus 0.74. With their
    // poles going round at the IAU's node rates, Miranda was 7.6 off at AD 1 and Mimas 2.6; with
    // Iapetus's pole on its Laplace pole, 8.3 off at every date.
    for (const jd of [1721425.5, 2460676.5, 2816787.4]) {
      renderer.update(jd);
      for (const id of ['miranda', 'mimas', 'iapetus']) {
        const moon = renderer.members.find((member) => member.id === id)!.marker;
        const line = moon.parent!.children.find((child) => child.name === 'orbit-line')!;
        const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(moon.quaternion);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(line.quaternion);
        // A line, not a direction: Miranda turns backwards against the IAU's pole.
        expect((Math.acos(Math.min(1, Math.abs(axis.dot(normal)))) * 180) / Math.PI).toBeLessThan(1);
      }
    }
  });
});
