import * as THREE from 'three/webgpu';

import { tdbFromUtc, TT_MINUS_UTC_DAYS } from '../astro/constants';
import { CartesianCoordinates, eclipticToEquatorial, laplacePlaneToEquatorial } from '../astro/coordinates';
import { meanElementsAt, positionAtEpoch } from '../astro/kepler';
import { orientationAt } from '../astro/rotational-elements';
import { BodyRecord, RotationalElements } from '../models/body.model';

const DEG_TO_RAD = Math.PI / 180;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
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
 * The clock is UT and the IAU's elements run on TDB, 69.184 s ahead today and 1 574 s at AD 1000;
 * in 69 s Earth turns 0.29 degrees, Jupiter 0.70 and Phobos 0.90, so the date is taken to TDB here
 * (see `tdbFromUtc`). Earth, `followsUt`, is the one exception: its turning is what UT counts,
 * so the clock's date already says how far it has turned, and its W, fitted to today, is taken at
 * that date plus today's TT - UTC. Taken at TDB, it would turn ΔT further: 44 degrees at AD 1.
 */
export function bodyOrientation(elements: RotationalElements, jdUtc: number, target = new THREE.Quaternion(), followsUt = false): THREE.Quaternion {
  const { poleRaDeg, poleDecDeg, primeMeridianDeg } = orientationAt(elements, followsUt ? jdUtc + TT_MINUS_UTC_DAYS : tdbFromUtc(jdUtc));
  return poleFrame({ raDeg: poleRaDeg, decDeg: poleDecDeg }, target)
    .multiply(scratchTurn.setFromAxisAngle(Z_AXIS, primeMeridianDeg * DEG_TO_RAD))
    .multiply(MAP_TO_BODY);
}

/** Where a body is from the Sun at a date, in the ICRF, AU: a moon's planet's place plus its own. */
function heliocentricPosition(body: BodyRecord, bodies: readonly BodyRecord[], jdUtc: number): CartesianCoordinates {
  const jdTdb = tdbFromUtc(jdUtc);
  const own = positionAtEpoch(meanElementsAt(body.orbit, body.rates, jdTdb));
  const parent = body.parentBodyId ? bodies.find((candidate) => candidate.id === body.parentBodyId) : undefined;
  if (!parent) {
    return eclipticToEquatorial(own);
  }
  const offset = body.laplacePole ? laplacePlaneToEquatorial(own, body.laplacePole) : eclipticToEquatorial(own);
  const centre = eclipticToEquatorial(positionAtEpoch(meanElementsAt(parent.orbit, parent.rates, jdTdb)));
  return { x: centre.x + offset.x, y: centre.y + offset.y, z: centre.z + offset.z };
}

const scratchPage = new THREE.Quaternion();
const scratchPageTurn = new THREE.Quaternion();
const scratchBody = new THREE.Quaternion();

/**
 * How the body page shows a body the IAU gives elements for: pole up, as the page has always
 * drawn it, turned as it really is at the map's date against a Sun held at `sunAzimuthRad` round
 * that pole — where the page's light has always stood, so the camera still opens on the day side.
 * The Sun's height above the equator is its real one, and the face it lights is the real one:
 * seen from the body, the Sun sits over the same point of its map as in the system view. What the
 * page gives up is the stars, which do not turn with the body.
 *
 * Sets `planet` to the sphere's rotation and `sun` to the unit direction of the Sun in the page's
 * frame. Returns false, touching neither, for a body without elements.
 */
export function bodyPageView(body: BodyRecord, bodies: readonly BodyRecord[], jdUtc: number, sunAzimuthRad: number, planet: THREE.Quaternion, sun: THREE.Vector3): boolean {
  const elements = body.rotationalElements;
  if (!elements) {
    return false;
  }
  const { poleRaDeg, poleDecDeg } = orientationAt(elements, tdbFromUtc(jdUtc));
  // From the ICRF into the body's frame with its pole on +Y, before the turn about that pole.
  const toPage = poleFrame({ raDeg: poleRaDeg, decDeg: poleDecDeg }, scratchPage).multiply(MAP_TO_BODY).invert();
  const position = heliocentricPosition(body, bodies, jdUtc);
  sun.set(-position.x, -position.y, -position.z).normalize().applyQuaternion(toPage);
  const turn = scratchPageTurn.setFromAxisAngle(Y_AXIS, sunAzimuthRad - Math.atan2(sun.x, sun.z));
  sun.applyQuaternion(turn);
  planet.copy(turn).multiply(toPage).multiply(bodyOrientation(elements, jdUtc, scratchBody, body.id === 'earth'));
  return true;
}
