import * as THREE from 'three/webgpu';

import { gmForParent } from '../../shared/astro/constants';
import { isPropagatableOrbit, orbitEllipsePoints, propagateOrbit, resolveGravitationalParameter, resolveOrbitalElements } from '../../shared/astro/kepler';
import { eclipticToEquatorial } from '../../shared/astro/coordinates';
import { BodyRecord, OrbitalElements } from '../../shared/models/body.model';
import { bodyMarkerRadiusAu } from './system-framing';
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

function buildOrbitLine(elements: OrbitalElements, kind: SystemMemberKind): THREE.Line {
  const points = orbitEllipsePoints(elements);
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    // Elements are ecliptic (Horizons' default reference plane); the scene is equatorial, to
    // match the star catalogue. Without this the orbits sit 23.4 degrees off the sky.
    const { x, y, z } = eclipticToEquatorial(point);
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

function buildMarker(kind: SystemMemberKind, radiusKm: number | undefined, systemSpanAu: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(bodyMarkerRadiusAu(radiusKm, systemSpanAu), 16, 12);
  const material = new THREE.MeshBasicMaterial({ color: colorForKind(kind) });
  return new THREE.Mesh(geometry, material);
}

interface TrackedTopLevelBody {
  id: string;
  kind: SystemMemberKind;
  elements: OrbitalElements;
  gmAu3PerDay2: number;
  marker: THREE.Mesh;
  /** AU position last computed for this body; moons read their parent's here. */
  position: THREE.Vector3;
}

interface TrackedMoon {
  id: string;
  elements: OrbitalElements;
  gmAu3PerDay2: number;
  marker: THREE.Mesh;
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

  private readonly topLevelBodies: TrackedTopLevelBody[] = [];
  private readonly moons: TrackedMoon[] = [];
  private readonly disposables: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];

  constructor(bodies: readonly BodyRecord[], exoplanets: readonly ExoplanetRecord[]) {
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
      const tracked = this.addTopLevelBody(body.id, kind, body.orbit, gmForParent(undefined), body.radiusKm);
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
      const moon = this.addMoon(body.id, body.orbit, gmForParent(body.parentBodyId), body.radiusKm, parentTracked);
      members.push({ id: body.id, kind: 'moon', marker: moon.marker });
    }

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
      const tracked = this.addTopLevelBody(exoplanet.id, 'exoplanet', elements, gm, radiusKm);
      members.push({ id: exoplanet.id, kind: 'exoplanet', marker: tracked.marker });
    }

    this.members = members;
  }

  /** Recomputes every marker's position for the given Julian date. Call once per tick. */
  update(epochJd: number): void {
    for (const body of this.topLevelBodies) {
      const { x, y, z } = eclipticToEquatorial(propagateOrbit(body.elements, body.gmAu3PerDay2, epochJd));
      body.position.set(x, y, z); // Equatorial, matching buildOrbitLine and the star field.
      body.marker.position.copy(body.position);
    }

    for (const moon of this.moons) {
      const parent = this.topLevelBodies.find((body) => body.id === moon.parentId);
      if (!parent) {
        continue;
      }
      moon.pivot.position.copy(parent.position);
      const { x, y, z } = eclipticToEquatorial(propagateOrbit(moon.elements, moon.gmAu3PerDay2, epochJd));
      moon.marker.position.set(x, y, z);
    }
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

  private addTopLevelBody(id: string, kind: SystemMemberKind, elements: OrbitalElements, gmAu3PerDay2: number, radiusKm: number | undefined): TrackedTopLevelBody {
    const orbitLine = buildOrbitLine(elements, kind);
    const marker = buildMarker(kind, radiusKm, this.maxTopLevelSemiMajorAxisAu);
    this.object.add(orbitLine, marker);
    this.trackDisposable(orbitLine.geometry, orbitLine.material as THREE.Material);
    this.trackDisposable(marker.geometry, marker.material as THREE.Material);

    const tracked: TrackedTopLevelBody = { id, kind, elements, gmAu3PerDay2, marker, position: new THREE.Vector3() };
    this.topLevelBodies.push(tracked);
    return tracked;
  }

  private addMoon(id: string, elements: OrbitalElements, gmAu3PerDay2: number, radiusKm: number | undefined, parent: TrackedTopLevelBody): TrackedMoon {
    const pivot = new THREE.Group();
    const orbitLine = buildOrbitLine(elements, 'moon');
    const marker = buildMarker('moon', radiusKm, this.maxTopLevelSemiMajorAxisAu);
    pivot.add(orbitLine, marker);
    this.object.add(pivot);
    this.trackDisposable(orbitLine.geometry, orbitLine.material as THREE.Material);
    this.trackDisposable(marker.geometry, marker.material as THREE.Material);

    const moon: TrackedMoon = { id, elements, gmAu3PerDay2, marker, pivot, parentId: parent.id };
    this.moons.push(moon);
    return moon;
  }

  private trackDisposable(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    this.disposables.push({ geometry, material });
  }
}
