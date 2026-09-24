import * as THREE from 'three/webgpu';

import { appearanceForBody, appearanceForExoplanet } from '../../shared/astro/body-appearance';
import { PlanetAppearance } from '../../shared/astro/planet-appearance';
import { planetTexture } from '../../shared/rendering/procedural-planet-texture';
import { bodyTexturePath, loadCachedTexture } from '../../shared/rendering/texture-catalog';
import { isPropagatableOrbit, keplerRates, meanElementsAt, orbitEllipsePoints, positionAtEpoch, resolveGravitationalParameter, resolveOrbitalElements } from '../../shared/astro/kepler';
import { CartesianCoordinates, laplacePlaneToEquatorial, OBLIQUITY_J2000_DEG } from '../../shared/astro/coordinates';
import { BodyRecord, MeanElementRates, OrbitalElements } from '../../shared/models/body.model';
import { bodyMarkerRadiusAu, systemGridRingsAu } from './system-framing';
import { PolarGridPlane, TetherField } from './grid-plane';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';

export type SystemMemberKind = 'planet' | 'moon' | 'dwarf' | 'exoplanet';

/** A pickable marker for one rendered body/exoplanet, keyed by its own record id. */
export interface SystemMember {
  id: string;
  kind: SystemMemberKind;
  marker: THREE.Object3D;
  /** For a moon, the id of the body it orbits: what its drawn size is held against. */
  parentId?: string;
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
 * obliquity about the shared vernal-equinox axis. The planets' and the Moon's mean elements are
 * given against the J2000 ecliptic, so this is their frame.
 */
const ECLIPTIC_FRAME = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), OBLIQUITY_J2000_DEG * DEG_TO_RAD);

/**
 * Rotation carrying a moon's element frame into the scene: its local Laplace plane where JPL
 * gives one, the ecliptic otherwise. Built from the three axes {@link laplacePlaneToEquatorial}
 * sends, so the scene and the ETL's check against Horizons share the one conversion.
 */
function moonFrame(body: BodyRecord): THREE.Quaternion {
  const pole = body.laplacePole;
  if (!pole) {
    return ECLIPTIC_FRAME.clone();
  }
  const axis = (x: number, y: number, z: number): THREE.Vector3 => {
    const turned = laplacePlaneToEquatorial({ x, y, z }, pole);
    return new THREE.Vector3(turned.x, turned.y, turned.z);
  };
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis(1, 0, 0), axis(0, 1, 0), axis(0, 0, 1)));
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const scratchTurn = new THREE.Quaternion();

/**
 * Sets `target` to the rotation carrying an orbit's own plane, periapsis along +X, into the
 * scene: the argument of periapsis, then the inclination, then the node, as
 * `positionAtTrueAnomaly` turns a point, and then the frame the elements are measured in.
 */
function orientOrbit(target: THREE.Quaternion, elements: OrbitalElements, frame: THREE.Quaternion): THREE.Quaternion {
  return target
    .copy(frame)
    .multiply(scratchTurn.setFromAxisAngle(Z_AXIS, elements.longitudeOfAscendingNodeDeg * DEG_TO_RAD))
    .multiply(scratchTurn.setFromAxisAngle(X_AXIS, elements.inclinationDeg * DEG_TO_RAD))
    .multiply(scratchTurn.setFromAxisAngle(Z_AXIS, elements.argumentOfPeriapsisDeg * DEG_TO_RAD));
}

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

/** Marks orbit lines so the whole layer can be toggled without touching the bodies. */
const ORBIT_LINE_NAME = 'orbit-line';

/**
 * The orbit's ellipse, drawn in its own plane and turned into place by the line's quaternion (see
 * {@link orientOrbit}), which `update` sets again each tick: a node and a periapsis that turn cost
 * a quaternion rather than a new geometry. The Moon's node goes right round in 18.6 years, so an
 * ellipse fixed at one date has the Moon up to 2 sin 5.16° of its distance, 69 000 km, off its own
 * line nine years on.
 *
 * The shape is the epoch's. The planets' axes and eccentricities do drift, but Pluto's axis, the
 * fastest, moves 0.0045 AU a century against 39.5, which no drawn line shows.
 */
function buildOrbitLine(elements: OrbitalElements, kind: SystemMemberKind, frame: THREE.Quaternion): THREE.Line {
  const points = orbitEllipsePoints({ ...elements, inclinationDeg: 0, longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0 });
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: colorForKind(kind),
    transparent: true,
    opacity: ORBIT_LINE_OPACITY_BY_KIND[kind]
  });

  const line = new THREE.Line(geometry, material);
  line.name = ORBIT_LINE_NAME;
  orientOrbit(line.quaternion, elements, frame);
  return line;
}

/**
 * A marker sphere, surfaced with the body's own photograph where one has ever been taken, and
 * with a texture derived from its measurements where none has — and lit by its star either way,
 * so a world shows the day and night it actually has.
 *
 * The photographs were already in the repository, used only by the detail page: the system view
 * drew every body from a 32 by 16 pixel procedural texture instead, which at a few pixels across
 * was indistinguishable from its average colour and, once the camera closed in, was a blur. A
 * marker can now fill the frame, so it takes the real image at the size the detail page uses.
 *
 * A derived texture is not painted here but handed to `deferSurface`, which paints it after the
 * system is built: at about 4.4 ms each, the twenty bodies the solar system gained with its dwarf
 * planets and smaller moons lengthened the task that enters it from 78-94 ms to 177-228. Until
 * then the body is its kind's flat colour.
 */
function buildMarker(
  id: string | undefined,
  kind: SystemMemberKind,
  radiusKm: number | undefined,
  appearance: PlanetAppearance | undefined,
  deferSurface: (paint: () => void) => void
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(bodyMarkerRadiusAu(radiusKm), MARKER_WIDTH_SEGMENTS, MARKER_HEIGHT_SEGMENTS);
  const photograph = id ? bodyTexturePath(id) : undefined;
  const map = photograph ? loadCachedTexture(photograph) : undefined;
  const material = new THREE.MeshStandardMaterial({
    map,
    color: map ? 0xffffff : colorForKind(kind),
    roughness: 1,
    metalness: 0
  });
  if (!photograph && appearance) {
    deferSurface(() => {
      // 128 by 64, not the detail page's 512 by 256: that size costs about 60 ms a body on the
      // main thread, for a disc that is a few pixels across until the camera is on top of it.
      material.map = planetTexture(appearance, { width: 128, height: 64 });
      material.color.set(0xffffff);
      material.needsUpdate = true;
    });
  }
  return new THREE.Mesh(geometry, material);
}

/**
 * The star's own light, at the centre of the system it lights.
 *
 * `decay` is 0, which is not what light does: a point source falls off with the square of the
 * distance, and under that law Neptune, at 30.2 AU, receives about a six-thousandth of what
 * Mercury does at 0.39 AU and reads as black. The map is a set of worlds to look at rather than a
 * light meter, so each is lit as a photograph of it would be — the same concession the pixel
 * floor makes for size. What the light does carry truthfully is which side is day: every body
 * shows its lit face toward the star, and the terminator falls where it really falls.
 *
 * White, at π: a Lambertian surface returns intensity / π of its texture where the light falls
 * square on it, so π gives back the photograph itself at the point facing the star, and less
 * towards the limb. A warm tint or a smaller figure darkened the photographs below what they are.
 */
function starLight(): THREE.PointLight {
  const light = new THREE.PointLight(0xffffff, Math.PI, 0, 0);
  light.position.set(0, 0, 0);
  return light;
}

/**
 * Sphere segments. On a UV sphere the silhouette seen down the pole is the ring of width segments
 * and the one seen from the side is the meridian profile, so height at half the width makes the
 * error the same from every direction: at 64 by 32 a body filling the screen — Jupiter reaches
 * 641 px of radius in the plan view — strays under a pixel from its true circle.
 */
const MARKER_WIDTH_SEGMENTS = 64;
const MARKER_HEIGHT_SEGMENTS = 32;

/**
 * A drawn radius, in Earth radii, for an exoplanet that has a mass and no measured radius — 1 076
 * of the 1 692 drawn, most of them found by radial velocity, and most of those giants: their
 * median is 315 Earth masses. Drawn at an Earth, as they were, a nine-Jupiter-mass planet came out
 * smaller than its system's super-Earth.
 *
 * A rough power law, capped at Jupiter's radius: giants from a third of a Jupiter mass to ten are
 * all about Jupiter's size, since past that point added mass compresses rather than inflates. It
 * sets a size to draw, not a figure to print — the readout still says the radius is unknown.
 */
function radiusFromMassEarth(massEarth: number | null | undefined): number | undefined {
  return massEarth && massEarth > 0 ? Math.min(JUPITER_RADIUS_EARTH, massEarth ** 0.55) : undefined;
}
const JUPITER_RADIUS_EARTH = 11.2;

/** Local axis a sphere is built around, and what the spin is applied about. */
const SPIN_AXIS = new THREE.Vector3(0, 1, 0);
const HOURS_PER_DAY = 24;

/**
 * How a body is turned at a given date: its own sidereal rotation, about its own axis.
 *
 * The obliquity fixes how far the pole leans from the orbit normal, and nothing more: which way
 * it leans needs the pole's right ascension, which the Horizons pages this reads do not carry. The
 * lean is taken about the orbit's ascending node because that is the one line the elements name,
 * not because the data says so — so the tilt is real and its azimuth is not. It is the node on the
 * date drawn, so the lean follows the orbit as the node turns. Likewise the phase: each body
 * starts at its elements' epoch (J2000 for the planets) in an arbitrary orientation, the
 * shortest rotation of +Y onto its axis, and turns from there. The rate and the sense are real;
 * the face towards the camera is not.
 *
 * Horizons states a retrograde spin twice over, in two conventions: an obliquity past 90 degrees
 * (Venus 177.3, Uranus 97.8) and a negative rate. Either one alone turns the body backwards, and
 * both together cancel into a forward turn — which is how Venus and Uranus were drawn. Where an
 * obliquity is given it carries the sense, and the period is taken as a magnitude; the sign of the
 * period is only read for a body with no obliquity at all.
 */
function spinFor(elements: OrbitalElements, frame: THREE.Quaternion, rotationPeriodHours: number, obliquityDeg: number | undefined, daysSinceEpoch: number): THREE.Quaternion {
  const node = elements.longitudeOfAscendingNodeDeg * DEG_TO_RAD;
  const inclination = elements.inclinationDeg * DEG_TO_RAD;
  const nodeDirection = new THREE.Vector3(Math.cos(node), Math.sin(node), 0);
  const axis = new THREE.Vector3(Math.sin(inclination) * Math.sin(node), -Math.sin(inclination) * Math.cos(node), Math.cos(inclination))
    .applyAxisAngle(nodeDirection, (obliquityDeg ?? 0) * DEG_TO_RAD)
    .applyQuaternion(frame);
  const period = obliquityDeg === undefined ? rotationPeriodHours : Math.abs(rotationPeriodHours);
  const turns = (daysSinceEpoch * HOURS_PER_DAY) / period;
  return new THREE.Quaternion()
    .setFromUnitVectors(SPIN_AXIS, axis)
    .multiply(new THREE.Quaternion().setFromAxisAngle(SPIN_AXIS, turns * 2 * Math.PI));
}

interface TrackedTopLevelBody {
  id: string;
  kind: SystemMemberKind;
  elements: OrbitalElements;
  rates: MeanElementRates;
  marker: THREE.Mesh;
  orbitLine: THREE.Line;
  /** Rotation from this body's own element frame into the scene's equatorial one. */
  frame: THREE.Quaternion;
  /** AU position last computed for this body; moons read their parent's here. */
  position: THREE.Vector3;
  /** Sidereal rotation, where the catalogue publishes one; negative is retrograde. */
  rotationPeriodHours?: number;
  obliquityDeg?: number;
}

interface TrackedMoon {
  id: string;
  elements: OrbitalElements;
  rates: MeanElementRates;
  marker: THREE.Mesh;
  orbitLine: THREE.Line;
  frame: THREE.Quaternion;
  pivot: THREE.Group;
  parentId: string;
  rotationPeriodHours?: number;
  obliquityDeg?: number;
  /**
   * Where the moon and its planet go round a barycentre outside the planet (Charon): the moon's
   * mass over the planet's, and the planet's own small orbit round that point.
   */
  barycentre?: { massRatio: number; parentOrbitLine: THREE.Line };
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
  /** Derived surfaces still to paint, one a task, once the constructor is done; see `buildMarker`. */
  private readonly surfacesToPaint: Array<() => void> = [];
  private surfaceTimer?: ReturnType<typeof setTimeout>;
  private readonly deferSurface = (paint: () => void): void => {
    this.surfacesToPaint.push(paint);
    this.surfaceTimer ??= setTimeout(this.paintNextSurface, 0);
  };
  private readonly paintNextSurface = (): void => {
    this.surfacesToPaint.shift()?.();
    this.surfaceTimer = this.surfacesToPaint.length > 0 ? setTimeout(this.paintNextSurface, 0) : undefined;
  };

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
      const tracked = this.addTopLevelBody(body.id, kind, body.orbit, body.rates, body.radiusKm, ECLIPTIC_FRAME, appearanceForBody(body, bodies, hostLuminositySolar), { periodHours: body.rotationPeriodHours, obliquityDeg: body.obliquityDeg });
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
      const moon = this.addMoon(body.id, body.orbit, body.rates, body.radiusKm, parentTracked, moonFrame(body), appearanceForBody(body, bodies, hostLuminositySolar), { periodHours: body.rotationPeriodHours, obliquityDeg: body.obliquityDeg }, body.massRatio);
      members.push({ id: body.id, kind: 'moon', marker: moon.marker, parentId: parent.id });
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
      const radiusEarth = exoplanet.radiusEarth ?? radiusFromMassEarth(exoplanet.massEarth);
      const radiusKm = radiusEarth ? radiusEarth * EARTH_RADIUS_KM : undefined;
      // Not the Sun's: that assumes a solar-mass host for every system, and most exoplanet hosts
      // are red dwarfs a fraction of the Sun's mass.
      const gm = resolveGravitationalParameter({
        semiMajorAxisAu: exoplanet.orbit.semiMajorAxisAu,
        periodDays: exoplanet.periodDays,
        hostStarMassSolar: exoplanet.hostStarMassSolar
      });
      const tracked = this.addTopLevelBody(exoplanet.id, 'exoplanet', elements, keplerRates(elements.semiMajorAxisAu, gm), radiusKm, exoplanetFrame, appearanceForExoplanet(exoplanet, hostLuminositySolar));
      members.push({ id: exoplanet.id, kind: 'exoplanet', marker: tracked.marker });
    }

    this.members = members;

    // Which plane the system is read against follows from where its elements came from. Only the
    // Sun has JPL bodies and no system has both, so this is a choice between the two rather
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
    // The star lights its own system. The star marker itself is unlit — it is the source, not a
    // surface — so nothing here changes how it is drawn.
    this.object.add(starLight());
  }

  /** Recomputes every marker's position for the given Julian date. Call once per tick. */
  update(epochJd: number): void {
    for (const body of this.topLevelBodies) {
      const current = meanElementsAt(body.elements, body.rates, epochJd);
      const orbital = positionAtEpoch(current);
      body.position.set(orbital.x, orbital.y, orbital.z).applyQuaternion(body.frame);
      body.marker.position.copy(body.position);
      orientOrbit(body.orbitLine.quaternion, current, body.frame);
      if (body.rotationPeriodHours) {
        body.marker.quaternion.copy(spinFor(current, body.frame, body.rotationPeriodHours, body.obliquityDeg, epochJd - body.elements.epochJd));
      }
    }

    for (const moon of this.moons) {
      const parent = this.topLevelBodies.find((body) => body.id === moon.parentId);
      if (!parent) {
        continue;
      }
      moon.pivot.position.copy(parent.position);
      const current = meanElementsAt(moon.elements, moon.rates, epochJd);
      const orbital = positionAtEpoch(current);
      moon.marker.position.set(orbital.x, orbital.y, orbital.z).applyQuaternion(moon.frame);
      orientOrbit(moon.orbitLine.quaternion, current, moon.frame);
      if (moon.barycentre) {
        // The planet's elements place the pair's barycentre, which is where the pivot is: the
        // planet sits the moon's share of their separation back from it, the moon the rest out.
        const { massRatio, parentOrbitLine } = moon.barycentre;
        parent.marker.position.copy(parent.position).addScaledVector(moon.marker.position, -massRatio / (1 + massRatio));
        moon.marker.position.multiplyScalar(1 / (1 + massRatio));
        parentOrbitLine.quaternion.copy(moon.orbitLine.quaternion);
      }
      if (moon.rotationPeriodHours) {
        moon.marker.quaternion.copy(spinFor(current, moon.frame, moon.rotationPeriodHours, moon.obliquityDeg, epochJd - moon.elements.epochJd));
      }
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

  /** Shows or hides the orbit lines and the reference grid, leaving the bodies themselves. */
  setLayerVisibility(layers: { orbits: boolean; grid: boolean }): void {
    this.object.traverse((child) => {
      if (child.name === ORBIT_LINE_NAME) {
        child.visible = layers.orbits;
      }
    });
    if (this.grid) {
      this.grid.object.visible = layers.grid;
    }
    if (this.tethers) {
      this.tethers.object.visible = layers.grid;
    }
  }

  dispose(): void {
    clearTimeout(this.surfaceTimer);
    this.surfacesToPaint.length = 0;
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
    rates: MeanElementRates,
    radiusKm: number | undefined,
    frame: THREE.Quaternion,
    appearance?: PlanetAppearance,
    rotation?: { periodHours?: number; obliquityDeg?: number }
  ): TrackedTopLevelBody {
    const orbitLine = buildOrbitLine(elements, kind, frame);
    const marker = buildMarker(id, kind, radiusKm, appearance, this.deferSurface);
    this.object.add(orbitLine, marker);
    this.trackDisposable(orbitLine.geometry, orbitLine.material as THREE.Material);
    this.trackDisposable(marker.geometry, marker.material as THREE.Material);

    const tracked: TrackedTopLevelBody = { id, kind, elements, rates, marker, orbitLine, frame, position: new THREE.Vector3(), rotationPeriodHours: rotation?.periodHours, obliquityDeg: rotation?.obliquityDeg };
    this.topLevelBodies.push(tracked);
    return tracked;
  }

  private addMoon(
    id: string,
    elements: OrbitalElements,
    rates: MeanElementRates,
    radiusKm: number | undefined,
    parent: TrackedTopLevelBody,
    frame: THREE.Quaternion,
    appearance?: PlanetAppearance,
    rotation?: { periodHours?: number; obliquityDeg?: number },
    massRatio?: number
  ): TrackedMoon {
    const pivot = new THREE.Group();
    const orbitLine = buildOrbitLine(elements, 'moon', frame);
    const marker = buildMarker(id, 'moon', radiusKm, appearance, this.deferSurface);
    pivot.add(orbitLine, marker);
    this.object.add(pivot);
    this.trackDisposable(orbitLine.geometry, orbitLine.material as THREE.Material);
    this.trackDisposable(marker.geometry, marker.material as THREE.Material);

    let barycentre: TrackedMoon['barycentre'];
    if (massRatio !== undefined) {
      // Both orbits are the relative one, scaled: the moon's by the planet's share of the mass,
      // the planet's by the moon's share and turned half round, since it is always opposite.
      // Charon's then spans 17 460 km of radius, Pluto's 2 131, and neither passes through Pluto.
      orbitLine.scale.setScalar(1 / (1 + massRatio));
      const parentOrbitLine = buildOrbitLine(elements, parent.kind, frame);
      parentOrbitLine.scale.setScalar(-massRatio / (1 + massRatio));
      pivot.add(parentOrbitLine);
      this.trackDisposable(parentOrbitLine.geometry, parentOrbitLine.material as THREE.Material);
      barycentre = { massRatio, parentOrbitLine };
    }

    const moon: TrackedMoon = { id, elements, rates, marker, orbitLine, frame, pivot, parentId: parent.id, rotationPeriodHours: rotation?.periodHours, obliquityDeg: rotation?.obliquityDeg, barycentre };
    this.moons.push(moon);
    return moon;
  }

  private trackDisposable(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    this.disposables.push({ geometry, material });
  }
}
