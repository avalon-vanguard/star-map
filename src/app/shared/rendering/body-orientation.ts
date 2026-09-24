import * as THREE from 'three/webgpu';

import { TT_MINUS_UTC_DAYS } from '../astro/constants';
import { laplacePlaneToEquatorial } from '../astro/coordinates';
import { orientationAt } from '../astro/rotational-elements';
import { RotationalElements } from '../models/body.model';

const DEG_TO_RAD = Math.PI / 180;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * How a surface map sits on a sphere, settled once for every map the app wraps.
 *
 * `THREE.SphereGeometry` is built round +Y and runs its u coordinate eastward, anticlockwise seen
 * from +Y, from a seam on -X: u = 0.5 faces +X and u = 0.75 faces -Z. Every photograph in
 * `texture-catalog.ts` is an equirectangular map centred on longitude 0 with east to the right —
 * Greenwich is in the middle of Earth's; on Mars's, Olympus Mons (226.2 E, which is -133.8) sits a
 * little over a third of the width left of centre; on the Moon's, Mare Crisium (59 E) is right of
 * centre and Mare Orientale (95 W) left of it; on Mercury's, the rayed crater Kuiper (31.5 W, 11 S)
 * is just left of centre and below the equator. A map labelled in west longitude, as most planets'
 * are, is still drawn with east to the right, as any map of a sphere seen from outside is; only its
 * numbers run the other way. So longitude 0 is +X and 90 E is -Z, and a quarter turn about X
 * carries that onto the IAU's body-fixed frame: pole +Z, prime meridian +X, 90 E +Y.
 *
 * The derived surfaces have no meridian of their own, and take the same convention.
 */
export const MAP_TO_BODY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

const scratchMatrix = new THREE.Matrix4();
const scratchAxes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const scratchTurn = new THREE.Quaternion();

/**
 * Sets `target` to the rotation carrying a frame whose +Z is `pole` and whose +X is where its
 * equator rises through the ICRF equator into the ICRF: the frame the IAU counts W in, and the
 * one JPL refers a moon's Laplace plane to — so both go through {@link laplacePlaneToEquatorial}.
 */
export function poleFrame(pole: { raDeg: number; decDeg: number }, target = new THREE.Quaternion()): THREE.Quaternion {
  const [x, y, z] = scratchAxes.map((axis, index) => {
    const turned = laplacePlaneToEquatorial({ x: index === 0 ? 1 : 0, y: index === 1 ? 1 : 0, z: index === 2 ? 1 : 0 }, pole);
    return axis.set(turned.x, turned.y, turned.z);
  });
  return target.setFromRotationMatrix(scratchMatrix.makeBasis(x, y, z));
}

/**
 * Sets `target` to the rotation carrying a sphere, wrapped in its map as `SphereGeometry` wraps it,
 * into the ICRF at the map's own clock: the map onto the body's frame, turned by W about the pole,
 * and on to where the pole points.
 *
 * The clock is UTC and the IAU's elements run on TDB, 69.184 s ahead; in that time Earth turns
 * 0.29 degrees, Jupiter 0.70 and Phobos 0.90, so the difference is added here.
 */
export function bodyOrientation(elements: RotationalElements, jdUtc: number, target = new THREE.Quaternion()): THREE.Quaternion {
  const { poleRaDeg, poleDecDeg, primeMeridianDeg } = orientationAt(elements, jdUtc + TT_MINUS_UTC_DAYS);
  return poleFrame({ raDeg: poleRaDeg, decDeg: poleDecDeg }, target)
    .multiply(scratchTurn.setFromAxisAngle(Z_AXIS, primeMeridianDeg * DEG_TO_RAD))
    .multiply(MAP_TO_BODY);
}

