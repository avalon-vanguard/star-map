import * as THREE from 'three/webgpu';

import { appearanceForBody, appearanceForExoplanet } from '../../shared/astro/body-appearance';
import { gmForParent } from '../../shared/astro/constants';
import { PlanetAppearance } from '../../shared/astro/planet-appearance';
import { MARKER_TEXTURE_HEIGHT, MARKER_TEXTURE_WIDTH, planetTexture } from '../../shared/rendering/procedural-planet-texture';
import { isPropagatableOrbit, orbitEllipsePoints, propagateOrbit, resolveGravitationalParameter, resolveOrbitalElements } from '../../shared/astro/kepler';
import { CartesianCoordinates, OBLIQUITY_J2000_DEG } from '../../shared/astro/coordinates';
import { BodyRecord, OrbitalElements } from '../../shared/models/body.model';
import { bodyMarkerRadiusAu, systemGridRingsAu } from './system-framing';
import { PolarGridPlane, TetherField } from './grid-plane';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';

export type SystemMemberKind = 'planet' | 'moon' | 'dwarf' | 'exoplanet';

/** A pickable marker for one rendered body/exoplanet, keyed by its own record id. */
export interface SystemMember {
  id: string;
  kind: SystemMemberKind;
  marker: THREE.Object3D;
}

const PLANET_COLOR = new THREE.Color(0.55, 0.75, 1.0);
const DWARF_COLOR = new THREE.Color(0.8, 0.7, 0.55);
const MOON_COLOR = new THREE.Color(0.75, 0.75, 0.75);
const EXOPLANET_COLOR = new THREE.Color(0.85, 0.4, 0.85);

const ORBIT_LINE_OPACITY_BY_KIND: Record<SystemMemberKind, number> = {
  planet: 0.5,
  dwarf: 0.4,
  moon: 0.35,
  exoplanet: 0.35
};

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;

/** Spokes on the system's reference grid, and how loudly it is drawn against the orbits. */
const SYSTEM_GRID_SPOKES = 12;
const SYSTEM_GRID_OPACITY = 0.28;
const SYSTEM_TETHER_OPACITY = 0.3;

/**
 * Rotation carrying the **ecliptic** frame into the scene's equatorial one — a turn of the
 * obliquity about the shared vernal-equinox axis. Solar-system elements come from Horizons
 * against the ecliptic, so this is their frame.
 */
const ECLIPTIC_FRAME = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), OBLIQUITY_J2000_DEG * DEG_TO_RAD);

/**
 * Rotation carrying the frame an **exoplanet's** elements are measured in into the scene.
 *
 * The Exoplanet Archive measures inclination from the *plane of the sky* — the plane
 * perpendicular to our line of sight to the host star — not from the ecliptic. 90 degrees means
 * edge-on as seen from Earth, which is why transiting planets cluster there: 1643 of the 2061
 * published inclinations are within 5 degrees of 90. Treating that as an ecliptic inclination
 * tips every transiting system on its side against a plane it was never measured against.
 *
 * Carrying the elements' +Z onto the line of sight fixes it: an inclination of `i` then means
 * the orbit's normal sits `i` from our line of sight, which is exactly the definition. The
 * rotation about that axis is the node's position angle on the sky, which the archive does not
 * publish, so the shortest arc from +Z is used — deterministic, and no less arbitrary than any
 * other choice given no data.
 *
 * Falls back to the ecliptic frame when there is no direction to work with.
 */
function skyPlaneFrame(lineOfSight: CartesianCoordinates | undefined): THREE.Quaternion {
  if (!lineOfSight) {
    return ECLIPTIC_FRAME.clone();
  }
  const direction = new THREE.Vector3(lineOfSight.x, lineOfSight.y, lineOfSight.z);
  if (direction.lengthSq() === 0) {
    return ECLIPTIC_FRAME.clone();
  }
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
}

function colorForKind(kind: SystemMemberKind): THREE.Color {
  switch (kind) {
    case 'planet':
      return PLANET_COLOR;
    case 'dwarf':
      return DWARF_COLOR;
    case 'moon':
      return MOON_COLOR;
    case 'exoplanet':
      return EXOPLANET_COLOR;
  }
}

function buildOrbitLine(elements: OrbitalElements, kind: SystemMemberKind, frame: THREE.Quaternion): THREE.Line {
  const points = orbitEllipsePoints(elements);
  const positions = new Float32Array(points.length * 3);
  const scratch = new THREE.Vector3();
  points.forEach((point, index) => {
    // Elements are measured against their source's own reference plane; `frame` rotates that
    // plane into the scene's equatorial one.
    const { x, y, z } = scratch.set(point.x, point.y, point.z).applyQuaternion(frame);
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: colorForKind(kind),
    transparent: true,
    opacity: ORBIT_LINE_OPACITY_BY_KIND[kind]
  });

  return new THREE.Line(geometry, material);
}

/**
 * A marker sphere, surfaced with the body's own derived appearance rather than a flat category
 * colour — so a system reads as a set of distinct worlds at a glance, and the colour of each is
 * a consequence of its measurements rather than of which list it came from.
 *
 * The texture is tiny (see `MARKER_TEXTURE_WIDTH`): a marker is a few pixels across, so what
 * survives is essentially its average colour, and generating it costs well under a millisecond.
 */
function buildMarker(kind: SystemMemberKind, radiusKm: number | undefined, systemSpanAu: number, appearance: PlanetAppearance | undefined): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(bodyMarkerRadiusAu(radiusKm, systemSpanAu), 16, 12);
  const material = appearance
    ? new THREE.MeshBasicMaterial({ map: planetTexture(appearance, { width: MARKER_TEXTURE_WIDTH, height: MARKER_TEXTURE_HEIGHT }) })
    : new THREE.MeshBasicMaterial({ color: colorForKind(kind) });
  return new THREE.Mesh(geometry, material);
}

interface TrackedTopLevelBody {
  id: string;
  kind: SystemMemberKind;
  elements: OrbitalElements;
  gmAu3PerDay2: number;
  marker: THREE.Mesh;
  /** Rotation from this body's own element frame into the scene's equatorial one. */
  frame: THREE.Quaternion;
  /** AU position last computed for this body; moons read their parent's here. */
  position: THREE.Vector3;
}

interface TrackedMoon {
  id: string;
  elements: OrbitalElements;
  gmAu3PerDay2: number;
  marker: THREE.Mesh;
  frame: THREE.Quaternion;
  pivot: THREE.Group;
  parentId: string;
}

/**
 * Builds and animates the orbit ellipses + planet/moon/exoplanet markers for one star system,
 * in AU, with the star itself at the origin. Moons are parented to a pivot group that tracks
 * their planet's live position each tick, so their (small, planet-relative) orbit ellipse and
 * marker never need to be rebuilt.
 */
export class SystemOrbitsRenderer {
  readonly object = new THREE.Group();
  readonly members: readonly SystemMember[];
  /** Largest semi-major axis (AU) among top-level bodies/exoplanets; 0 if there are none. */
  readonly maxTopLevelSemiMajorAxisAu: number;
  /** Smallest semi-major axis (AU) among top-level bodies/exoplanets; 0 if there are none. */
  readonly minTopLevelSemiMajorAxisAu: number;
  /**
   * The plane this system is read against, as a rotation from XY into the scene's equatorial
   * frame: the ecliptic for the solar system, the plane of the sky for everything else.
   */
  readonly referenceFrame: THREE.Quaternion;
  /**
   * Outer radius (AU) of the reference grid, or 0 where there is none. This — not the outermost
   * orbit — is the widest thing the system draws, so it is what the camera has to frame.
   */
  readonly gridOuterRadiusAu: number;

  private readonly topLevelBodies: TrackedTopLevelBody[] = [];
  private readonly moons: TrackedMoon[] = [];
  private readonly disposables: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
  private readonly grid?: PolarGridPlane;
  private readonly tethers?: TetherField;
  /**
   * Aliases of the tracked bodies' own position vectors, which `update` writes in place — so
   * following them each tick costs no allocation at all.
   */
  private tetherPoints: readonly THREE.Vector3[] = [];

  constructor(
    bodies: readonly BodyRecord[],
    exoplanets: readonly ExoplanetRecord[],
    /** Direction from the Sun to this system's host star, equatorial — the exoplanet line of sight. */
    hostStarDirection?: CartesianCoordinates,
    /**
     * The host star's luminosity in solar units, which is what sets how hot each body in the
     * system is and therefore what it looks like. Omitted for a host that is not in the star
     * catalogue, leaving its bodies classified on size and density alone.
     */
    hostLuminositySolar?: number | null
  ) {
    const members: SystemMember[] = [];
    const topLevelBodiesById = new Map<string, BodyRecord>();

    // Measured before anything is built, because marker sizes are scaled against the span and
    // the markers are created as the bodies are added.
    const topLevelAxes = [
      ...bodies.filter((body) => !body.parentBodyId).map((body) => body.orbit.semiMajorAxisAu),
      ...exoplanets.filter((exoplanet) => isPropagatableOrbit(exoplanet.orbit)).map((exoplanet) => exoplanet.orbit.semiMajorAxisAu!)
    ].filter((axis) => Number.isFinite(axis) && axis > 0);
    this.maxTopLevelSemiMajorAxisAu = topLevelAxes.length > 0 ? Math.max(...topLevelAxes) : 0;
    this.minTopLevelSemiMajorAxisAu = topLevelAxes.length > 0 ? Math.min(...topLevelAxes) : 0;

    for (const body of bodies) {
      if (!body.parentBodyId) {
        topLevelBodiesById.set(body.id, body);
      }
    }

    for (const body of bodies) {
      if (body.parentBodyId) {
        continue;
      }
      // A body reaches here only when it has no parentBodyId, so `kind` is 'planet' or 'dwarf'.
      const kind: SystemMemberKind = body.kind;
      const tracked = this.addTopLevelBody(body.id, kind, body.orbit, gmForParent(undefined), body.radiusKm, ECLIPTIC_FRAME, appearanceForBody(body, bodies, hostLuminositySolar));
      members.push({ id: body.id, kind, marker: tracked.marker });
    }

    for (const body of bodies) {
      if (!body.parentBodyId) {
        continue;
      }
      const parent = topLevelBodiesById.get(body.parentBodyId);
      const parentTracked = parent && this.topLevelBodies.find((tracked) => tracked.id === parent.id);
      if (!parentTracked) {
        continue; // orphaned moon reference; skip rather than crash.
      }
      const moon = this.addMoon(body.id, body.orbit, gmForParent(body.parentBodyId), body.radiusKm, parentTracked, ECLIPTIC_FRAME, appearanceForBody(body, bodies, hostLuminositySolar));
      members.push({ id: body.id, kind: 'moon', marker: moon.marker });
    }

    // Every exoplanet in a system shares the same line of sight, so the frame is built once.
    const exoplanetFrame = skyPlaneFrame(hostStarDirection);

    for (const exoplanet of exoplanets) {
      // Only a semi-major axis is genuinely required; resolveOrbitalElements defaults the rest,
      // eccentricity included. Demanding a published eccentricity as well used to drop 1509
      // otherwise drawable planets, so a user could open one's detail page, jump to its system,
      // and find it missing from the very system it belongs to.
      if (!isPropagatableOrbit(exoplanet.orbit)) {
        continue;
      }
      const elements = resolveOrbitalElements(exoplanet.orbit);
      const radiusKm = exoplanet.radiusEarth ? exoplanet.radiusEarth * EARTH_RADIUS_KM : undefined;
      // Not `gmForParent(undefined)`: that assumes a solar-mass host for every system, and
      // most exoplanet hosts are red dwarfs a fraction of the Sun's mass.
      const gm = resolveGravitationalParameter({
        semiMajorAxisAu: exoplanet.orbit.semiMajorAxisAu,
        periodDays: exoplanet.periodDays,
        hostStarMassSolar: exoplanet.hostStarMassSolar
      });
      const tracked = this.addTopLevelBody(exoplanet.id, 'exoplanet', elements, gm, radiusKm, exoplanetFrame, appearanceForExoplanet(exoplanet, hostLuminositySolar));
      members.push({ id: exoplanet.id, kind: 'exoplanet', marker: tracked.marker });
    }

    this.members = members;

    // Which plane the system is read against follows from where its elements came from. Only the
    // Sun has Horizons bodies and no system has both, so this is a choice between the two rather
    // than a compromise: the ecliptic if there are solar-system bodies, the sky plane otherwise.
    this.referenceFrame = bodies.some((body) => !body.parentBodyId) ? ECLIPTIC_FRAME.clone() : exoplanetFrame;

    const rings = systemGridRingsAu(this.maxTopLevelSemiMajorAxisAu);
    this.gridOuterRadiusAu = rings.length > 0 ? rings[rings.length - 1] : 0;
    if (rings.length > 0) {
      this.grid = new PolarGridPlane({
        ringRadii: rings,
        spokeCount: SYSTEM_GRID_SPOKES,
        orientation: this.referenceFrame,
        // Quieter and dashed, unlike the galaxy view's: here the grid shares a plane with the
        // orbit ellipses, which are themselves rings, and it must not be mistaken for one.
        opacity: SYSTEM_GRID_OPACITY,
        dashed: true,
        emphasisRadii: [rings[rings.length - 1]]
      });
      this.grid.setStrength(1);

      this.tethers = new TetherField(this.topLevelBodies.length, {
        normal: new THREE.Vector3(0, 0, 1).applyQuaternion(this.referenceFrame),
        opacity: SYSTEM_TETHER_OPACITY
      });
      this.tethers.setStrength(1);
      this.tetherPoints = this.topLevelBodies.map((body) => body.position);

      this.object.add(this.grid.object, this.tethers.object);
    }
  }

  /** Recomputes every marker's position for the given Julian date. Call once per tick. */
  update(epochJd: number): void {
    for (const body of this.topLevelBodies) {
      const orbital = propagateOrbit(body.elements, body.gmAu3PerDay2, epochJd);
      body.position.set(orbital.x, orbital.y, orbital.z).applyQuaternion(body.frame);
      body.marker.position.copy(body.position);
    }

    for (const moon of this.moons) {
      const parent = this.topLevelBodies.find((body) => body.id === moon.parentId);
      if (!parent) {
        continue;
      }
      moon.pivot.position.copy(parent.position);
      const orbital = propagateOrbit(moon.elements, moon.gmAu3PerDay2, epochJd);
      moon.marker.position.set(orbital.x, orbital.y, orbital.z).applyQuaternion(moon.frame);
    }

    // Moons are left out: their tether would land within a marker's width of their planet's and
    // say nothing the planet's has not already said.
    this.tethers?.setTargets(this.tetherPoints);
  }

  /** Looks up which system member a marker object belongs to (e.g. from a raycast hit). */
  memberForObject(object: THREE.Object3D): SystemMember | undefined {
    return this.members.find((member) => member.marker === object);
  }

  /** All marker objects, for raycasting. */
  get pickableObjects(): THREE.Object3D[] {
    return this.members.map((member) => member.marker);
  }

  dispose(): void {
    this.grid?.dispose();
    this.tethers?.dispose();
    for (const { geometry, material } of this.disposables) {
      geometry.dispose();
      material.dispose();
    }
    // Detach as well as dispose. A star-to-star hop builds a new renderer and drops the old
    // one, but without this the old orbit lines and markers stay parented to the system group
    // forever — still traversed and re-uploaded every frame despite their geometries being
    // disposed, and drawn over the new system while being unpickable.
    this.object.removeFromParent();
    this.object.clear();
  }

  private addTopLevelBody(
    id: string,
    kind: SystemMemberKind,
    elements: OrbitalElements,
    gmAu3PerDay2: number,
    radiusKm: number | undefined,
    frame: THREE.Quaternion,
    appearance?: PlanetAppearance
  ): TrackedTopLevelBody {
    const orbitLine = buildOrbitLine(elements, kind, frame);
    const marker = buildMarker(kind, radiusKm, this.maxTopLevelSemiMajorAxisAu, appearance);
    this.object.add(orbitLine, marker);
    this.trackDisposable(orbitLine.geometry, orbitLine.material as THREE.Material);
    this.trackDisposable(marker.geometry, marker.material as THREE.Material);

    const tracked: TrackedTopLevelBody = { id, kind, elements, gmAu3PerDay2, marker, frame, position: new THREE.Vector3() };
    this.topLevelBodies.push(tracked);
    return tracked;
  }

  private addMoon(
    id: string,
    elements: OrbitalElements,
    gmAu3PerDay2: number,
    radiusKm: number | undefined,
    parent: TrackedTopLevelBody,
    frame: THREE.Quaternion,
    appearance?: PlanetAppearance
  ): TrackedMoon {
    const pivot = new THREE.Group();
    const orbitLine = buildOrbitLine(elements, 'moon', frame);
    const marker = buildMarker('moon', radiusKm, this.maxTopLevelSemiMajorAxisAu, appearance);
    pivot.add(orbitLine, marker);
    this.object.add(pivot);
    this.trackDisposable(orbitLine.geometry, orbitLine.material as THREE.Material);
    this.trackDisposable(marker.geometry, marker.material as THREE.Material);

    const moon: TrackedMoon = { id, elements, gmAu3PerDay2, marker, frame, pivot, parentId: parent.id };
    this.moons.push(moon);
    return moon;
  }

  private trackDisposable(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    this.disposables.push({ geometry, material });
  }
}
