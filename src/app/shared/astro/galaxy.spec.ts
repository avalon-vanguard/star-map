import { describe, expect, it } from 'vitest';

import { CartesianCoordinates } from './coordinates';
import {
  armRadiusPc,
  BAR_HALF_LENGTH_PC,
  DISC_RADIUS_PC,
  equatorialToGalactic,
  GALACTIC_BASIS_EQUATORIAL,
  GALACTIC_LANDMARKS,
  galacticCentrePositionPc,
  galacticToEquatorial,
  galactocentricToHeliocentricGalactic,
  landmarkPositionPc,
  MILKY_WAY_ARMS,
  ORION_SPUR,
  SUN_GALACTOCENTRIC_RADIUS_PC,
  SUN_HEIGHT_ABOVE_MIDPLANE_PC
} from './galaxy';

const RAD_TO_DEG = 180 / Math.PI;

function dot(a: CartesianCoordinates, b: CartesianCoordinates): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: CartesianCoordinates): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Galactic longitude of a heliocentric galactic vector, in degrees, 0-360. */
function galacticLongitudeDeg(v: CartesianCoordinates): number {
  return (Math.atan2(v.y, v.x) * RAD_TO_DEG + 360) % 360;
}

describe('GALACTIC_BASIS_EQUATORIAL', () => {
  it('is an orthonormal basis', () => {
    const { x, y, z } = GALACTIC_BASIS_EQUATORIAL;
    for (const axis of [x, y, z]) {
      expect(length(axis)).toBeCloseTo(1, 12);
    }
    expect(dot(x, y)).toBeCloseTo(0, 12);
    expect(dot(y, z)).toBeCloseTo(0, 12);
    expect(dot(z, x)).toBeCloseTo(0, 12);
  });

  it('is right-handed, so the model is rotated rather than mirrored', () => {
    const { x, y, z } = GALACTIC_BASIS_EQUATORIAL;
    const cross = { x: x.y * y.z - x.z * y.y, y: x.z * y.x - x.x * y.z, z: x.x * y.y - x.y * y.x };
    expect(cross.x).toBeCloseTo(z.x, 12);
    expect(cross.y).toBeCloseTo(z.y, 12);
    expect(cross.z).toBeCloseTo(z.z, 12);
  });
});

describe('galacticToEquatorial', () => {
  it('is inverted exactly by equatorialToGalactic', () => {
    for (const point of [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: -8178, y: 4200, z: -75 }
    ]) {
      const round = equatorialToGalactic(galacticToEquatorial(point));
      expect(round.x).toBeCloseTo(point.x, 8);
      expect(round.y).toBeCloseTo(point.y, 8);
      expect(round.z).toBeCloseTo(point.z, 8);
    }
  });

  it('preserves length, being a rotation', () => {
    const rotated = galacticToEquatorial({ x: 300, y: -450, z: 120 });
    expect(length(rotated)).toBeCloseTo(length({ x: 300, y: -450, z: 120 }), 9);
  });

  it('sends the galactic pole to the catalogued equatorial direction of the pole', () => {
    // Dec of the north galactic pole is +27.12825 degrees, so its equatorial z is sin of that.
    const pole = galacticToEquatorial({ x: 0, y: 0, z: 1 });
    expect(Math.asin(pole.z) * RAD_TO_DEG).toBeCloseTo(27.12825, 6);
  });

  it('puts the galactic plane at about 60 degrees to the celestial equator', () => {
    // The complement of the pole's declination: the two planes are as far apart as their poles.
    const pole = galacticToEquatorial({ x: 0, y: 0, z: 1 });
    expect(90 - Math.asin(pole.z) * RAD_TO_DEG).toBeCloseTo(62.87, 1);
  });
});

describe('galactocentricToHeliocentricGalactic', () => {
  it('places the Sun at the origin, at its own radius and zero azimuth', () => {
    const sun = galactocentricToHeliocentricGalactic(SUN_GALACTOCENTRIC_RADIUS_PC, 0, SUN_HEIGHT_ABOVE_MIDPLANE_PC);
    expect(sun.x).toBeCloseTo(0, 9);
    expect(sun.y).toBeCloseTo(0, 9);
    expect(sun.z).toBeCloseTo(0, 9);
  });

  it('puts the midplane below the Sun, not through it', () => {
    const belowSun = galactocentricToHeliocentricGalactic(SUN_GALACTOCENTRIC_RADIUS_PC, 0, 0);
    expect(belowSun.z).toBeCloseTo(-SUN_HEIGHT_ABOVE_MIDPLANE_PC, 9);
  });

  it('places the galactic centre toward longitude zero at the Sun-centre distance', () => {
    const centre = galactocentricToHeliocentricGalactic(0, 0, 0);
    expect(galacticLongitudeDeg(centre)).toBeCloseTo(0, 6);
    expect(Math.hypot(centre.x, centre.y)).toBeCloseTo(SUN_GALACTOCENTRIC_RADIUS_PC, 6);
  });

  it('sends increasing azimuth toward longitude 90, the direction of rotation', () => {
    const ahead = galactocentricToHeliocentricGalactic(SUN_GALACTOCENTRIC_RADIUS_PC, 30, 0);
    expect(ahead.y).toBeGreaterThan(0);
    expect(galacticLongitudeDeg(ahead)).toBeGreaterThan(0);
    expect(galacticLongitudeDeg(ahead)).toBeLessThan(180);
  });
});

describe('galacticCentrePositionPc', () => {
  it('is the Sun-centre distance away, in the equatorial frame', () => {
    expect(length(galacticCentrePositionPc())).toBeCloseTo(Math.hypot(SUN_GALACTOCENTRIC_RADIUS_PC, SUN_HEIGHT_ABOVE_MIDPLANE_PC), 6);
  });

  it('lands within a tenth of a degree of the catalogued direction of Sagittarius A*', () => {
    // The two are not identical by construction: galactic latitude zero is defined by the disc
    // the Sun orbits in, and Sgr A* sits a few hundredths of a degree off it.
    const centre = galacticCentrePositionPc();
    const catalogued = galacticToEquatorial({ x: 1, y: 0, z: 0 });
    const cosAngle = dot(centre, catalogued) / length(centre);
    expect(Math.acos(cosAngle) * RAD_TO_DEG).toBeLessThan(0.2);
  });
});

describe('armRadiusPc', () => {
  it('returns the reference radius at the reference azimuth', () => {
    for (const arm of MILKY_WAY_ARMS) {
      expect(armRadiusPc(arm, arm.referenceAzimuthDeg)).toBeCloseTo(arm.referenceRadiusPc, 6);
    }
  });

  it('winds inward as azimuth increases, so the arms trail', () => {
    for (const arm of MILKY_WAY_ARMS) {
      expect(armRadiusPc(arm, arm.referenceAzimuthDeg + 40)).toBeLessThan(arm.referenceRadiusPc);
    }
  });

  it('keeps every arm inside the modelled disc over its traced range', () => {
    for (const arm of [...MILKY_WAY_ARMS, ORION_SPUR]) {
      expect(armRadiusPc(arm, arm.fromAzimuthDeg)).toBeLessThanOrEqual(DISC_RADIUS_PC);
      expect(armRadiusPc(arm, arm.toAzimuthDeg)).toBeGreaterThan(0);
    }
  });

  it('keeps every arm clear of the bar, so the spiral starts where the bar ends', () => {
    for (const arm of MILKY_WAY_ARMS) {
      for (let beta = arm.fromAzimuthDeg; beta <= arm.toAzimuthDeg; beta += 10) {
        expect(armRadiusPc(arm, beta)).toBeGreaterThan(0);
      }
      expect(arm.referenceRadiusPc).toBeGreaterThan(BAR_HALF_LENGTH_PC * 0.9);
    }
  });

  it('brackets the Sun between the Sagittarius and Perseus arms at the Sun azimuth', () => {
    // The one arrangement the local star field depends on: the solar neighbourhood sits in the
    // gap between them, on the minor spur, not inside a major arm.
    const sagittarius = MILKY_WAY_ARMS.find((arm) => arm.name.startsWith('Sagittarius'))!;
    const perseus = MILKY_WAY_ARMS.find((arm) => arm.name === 'Perseus')!;

    expect(armRadiusPc(sagittarius, 0)).toBeLessThan(SUN_GALACTOCENTRIC_RADIUS_PC);
    expect(armRadiusPc(perseus, 0)).toBeGreaterThan(SUN_GALACTOCENTRIC_RADIUS_PC);
  });

  it('runs the Orion Spur past the Sun, close to the Sun radius', () => {
    expect(Math.abs(armRadiusPc(ORION_SPUR, 0) - SUN_GALACTOCENTRIC_RADIUS_PC)).toBeLessThan(600);
  });
});

describe('GALACTIC_LANDMARKS', () => {
  it('has a unique id per landmark', () => {
    const ids = GALACTIC_LANDMARKS.map((landmark) => landmark.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names one landmark per modelled arm, plus the centre, the Sun and the spur', () => {
    expect(GALACTIC_LANDMARKS).toHaveLength(MILKY_WAY_ARMS.length + 3);
  });

  it('puts Sol back at the origin', () => {
    const sol = GALACTIC_LANDMARKS.find((landmark) => landmark.id === 'sol')!;
    const position = landmarkPositionPc(sol);
    // The Sun is the origin of the scene's coordinates, give or take its height above the plane,
    // which the landmark deliberately drops so the label sits on the map rather than off it.
    expect(Math.hypot(position.x, position.y, position.z)).toBeCloseTo(SUN_HEIGHT_ABOVE_MIDPLANE_PC, 6);
  });

  it('keeps every landmark inside the modelled disc', () => {
    for (const landmark of GALACTIC_LANDMARKS) {
      expect(length(landmarkPositionPc(landmark))).toBeLessThan(DISC_RADIUS_PC * 2);
    }
  });
});
