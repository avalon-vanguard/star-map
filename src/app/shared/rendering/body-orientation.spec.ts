import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { tdbFromUtc } from '../astro/constants';
import { eclipticToEquatorial } from '../astro/coordinates';
import { meanElementsAt, positionAtEpoch } from '../astro/kepler';
import { BodyRecord } from '../models/body.model';
import { bodyOrientation, bodyPageView } from './body-orientation';

// Earth (the Earth-Moon barycentre's mean elements) and the Moon as bodies.json carries them.
const EARTH: BodyRecord = {
  id: 'earth', systemStarId: 0, name: 'Earth', kind: 'planet', radiusKm: 6371, orbitSource: 'test',
  orbit: {semiMajorAxisAu: 1.00000018, eccentricity: 0.01673163, inclinationDeg: -0.00054346, longitudeOfAscendingNodeDeg: -5.11260389, argumentOfPeriapsisDeg: 108.04266274, meanAnomalyAtEpochDeg: -2.4631431299999917, epochJd: 2451545},
  rates: {meanMotionDegPerDay: 0.9856091187759068, longitudeOfAscendingNodeDegPerDay: -0.000006604751813826146, argumentOfPeriapsisDegPerDay: 0.000015309819575633124, semiMajorAxisAuPerDay: -8.213552361396303e-13, eccentricityPerDay: -1.002327173169062e-9, inclinationDegPerDay: -3.6609938398357287e-7},
  rotationalElements: {poleRaDeg: [0, -0.641, 0], poleDecDeg: [90, -0.557, 0], primeMeridianDeg: [190.147, 360.9856235, 0]}
};
const MOON: BodyRecord = {
  id: 'moon', systemStarId: 0, name: 'Moon', kind: 'moon', radiusKm: 1737.4, orbitSource: 'test', parentBodyId: 'earth',
  orbit: {semiMajorAxisAu: 0.0025695552897999907, eccentricity: 0.0554, inclinationDeg: 5.16, longitudeOfAscendingNodeDeg: 125.08, argumentOfPeriapsisDeg: 318.15, meanAnomalyAtEpochDeg: 135.27, epochJd: 2451545},
  rates: {meanMotionDegPerDay: 13.176358, longitudeOfAscendingNodeDegPerDay: -0.052990660396105185, argumentOfPeriapsisDegPerDay: 0.164353223839846},
  rotationalElements: {poleRaDeg: [269.9949, 0.0031, 0], poleDecDeg: [66.5392, 0.013, 0], primeMeridianDeg: [38.3213, 13.17635815, -1.4e-12], terms: [{angleDeg: [125.045, -1935.5364525], ra: -3.8787, dec: 1.5419, pm: 3.561}, {angleDeg: [250.089, -3871.072905], ra: -0.1204, dec: 0.0239, pm: 0.1208}, {angleDeg: [260.008, 475263.3328725], ra: 0.07, dec: -0.0278, pm: -0.0642}, {angleDeg: [176.625, 487269.629985], ra: -0.0172, dec: 0.0068, pm: 0.0158}, {angleDeg: [357.529, 35999.0509575], ra: 0, dec: 0, pm: 0.0252}]}
};
const BODIES = [EARTH, MOON];
const JUNE_1_2025_NOON_UTC = 2460828.0;
/** The page's light, at (4, 3, 5): 38.7 degrees round from the camera's side. */
const SUN_AZIMUTH = Math.atan2(4, 5);

/** The point of the page's sphere, as east longitude and latitude on its map, that faces the Sun. */
function subSolarPoint(body: BodyRecord, jdUtc: number): { eastDeg: number; latDeg: number } {
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32));
  const sun = new THREE.Vector3();
  expect(bodyPageView(body, BODIES, jdUtc, SUN_AZIMUTH, sphere.quaternion, sun)).toBe(true);
  sphere.updateMatrixWorld();
  const hit = new THREE.Raycaster(sun.clone().multiplyScalar(4), sun.clone().negate()).intersectObject(sphere)[0];
  return { eastDeg: (hit.uv!.x - 0.5) * 360, latDeg: (hit.uv!.y - 0.5) * 180 };
}

describe('bodyPageView', () => {
  it('lights the same face of Earth on its page: within 4 degrees of Greenwich at noon UTC, and where Horizons has it', () => {
    expect(Math.abs(subSolarPoint(EARTH, JUNE_1_2025_NOON_UTC).eastDeg)).toBeLessThan(4);
    // Horizons' sub-solar point from the Sun, 1.5795 E and 22.2604 N, is Earth as it was 8.43
    // minutes before, when the light arriving then left the Sun; its latitude is geodetic, on the
    // flattened Earth, where the sphere's is geocentric: 0.14 degrees apart at this latitude.
    const horizons = subSolarPoint(EARTH, JUNE_1_2025_NOON_UTC - 8.43351424 / 1440);
    const geodetic = (Math.atan(Math.tan((horizons.latDeg * Math.PI) / 180) / (1 - 1 / 298.257) ** 2) * 180) / Math.PI;
    expect(Math.abs(horizons.eastDeg - 1.579501)).toBeLessThan(0.1);
    expect(Math.abs(geodetic - 22.260426)).toBeLessThan(0.05);
  });

  it('lights Earth’s face where Horizons does at the far end of the clock too: AD 1000 and AD 1', () => {
    // Horizons' sub-solar longitude from the Sun (observer quantity 14, TIME_TYPE=UT), Earth taken
    // one light-time back: 1.0510 E on JD 2086455 and 1.5606 E on JD 1721600. The IAU's W, taken at
    // UT + 69.184 s as it was, drew them 2.3 and 4.5 degrees west of that (2.0 and 4.2 at UT itself).
    for (const [jdUt, lightMinutes, eastDeg] of [[2086455, 8.45437443, 1.05101], [1721600, 8.45020842, 1.560644]]) {
      expect(Math.abs(subSolarPoint(EARTH, jdUt - lightMinutes / 1440).eastDeg - eastDeg)).toBeLessThan(0.15);
    }
  });

  it('takes a moon’s Sun from where it and its planet are: the Moon’s sub-solar point is Horizons’', () => {
    const moon = subSolarPoint(MOON, JUNE_1_2025_NOON_UTC);
    // 116.2859 E and 1.5030 N, seen from Earth's centre.
    expect(Math.abs(moon.eastDeg - 116.285934)).toBeLessThan(0.1);
    expect(Math.abs(moon.latDeg - 1.503004)).toBeLessThan(0.05);
  });

  it('takes the Sun where it stands at the same TDB instant the body is turned for, and Earth turned as the system view turns it', () => {
    // Earth's own sphere, turned as the system view turns it (by UT, see `bodyOrientation`), and
    // the Sun seen from Earth's mean place at the clock's date taken to TDB: the page must light that
    // same point of its map, today and at AD 1000, when TT was 1 574 s past UT.
    for (const jdUt of [JUNE_1_2025_NOON_UTC, 2086307.5]) {
      const planet = new THREE.Quaternion();
      const sun = new THREE.Vector3();
      bodyPageView(EARTH, BODIES, jdUt, SUN_AZIMUTH, planet, sun);
      const place = eclipticToEquatorial(positionAtEpoch(meanElementsAt(EARTH.orbit, EARTH.rates, tdbFromUtc(jdUt))));
      const expected = new THREE.Vector3(-place.x, -place.y, -place.z).normalize().applyQuaternion(bodyOrientation(EARTH.rotationalElements!, jdUt, undefined, true).invert());
      expect(sun.clone().applyQuaternion(planet.clone().invert()).angleTo(expected)).toBeLessThan(1e-9);
    }
  });

  it('keeps the pole up and the Sun where the page’s light stands, turning the body under it', () => {
    const planet = new THREE.Quaternion();
    const sun = new THREE.Vector3();
    for (const hours of [0, 6, 12]) {
      bodyPageView(EARTH, BODIES, JUNE_1_2025_NOON_UTC + hours / 24, SUN_AZIMUTH, planet, sun);
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(planet).angleTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9);
      expect(Math.atan2(sun.x, sun.z)).toBeCloseTo(SUN_AZIMUTH, 9);
    }
  });

  it('leaves a body with no elements to the page, as it was', () => {
    const planet = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize();
    const before = planet.clone();
    const sun = new THREE.Vector3(4, 3, 5);

    expect(bodyPageView({ ...EARTH, rotationalElements: undefined }, BODIES, JUNE_1_2025_NOON_UTC, SUN_AZIMUTH, planet, sun)).toBe(false);
    expect(planet.equals(before)).toBe(true);
    expect(sun.toArray()).toEqual([4, 3, 5]);
  });
});
