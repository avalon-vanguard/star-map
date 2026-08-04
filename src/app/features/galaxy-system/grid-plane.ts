import * as THREE from 'three/webgpu';

import { GALACTIC_BASIS_EQUATORIAL, SUN_HEIGHT_ABOVE_MIDPLANE_PC } from '../../shared/astro/galaxy';

const SEGMENTS_PER_RING = 180;

/**
 * The rotation that carries the galactic frame's axes onto the scene's equatorial ones, as a
 * quaternion — so a grid built flat in XY comes out lying in the galactic plane, tilted the
 * real 63 degrees against the celestial equator rather than parked on an arbitrary plane.
 */
export function galacticFrameQuaternion(): THREE.Quaternion {
  const { x, y, z } = GALACTIC_BASIS_EQUATORIAL;
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(x.x, x.y, x.z), new THREE.Vector3(y.x, y.y, y.z), new THREE.Vector3(z.x, z.y, z.z));
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

/** The galactic plane's unit normal, in the equatorial frame. */
export function galacticNormal(): THREE.Vector3 {
  const { z } = GALACTIC_BASIS_EQUATORIAL;
  return new THREE.Vector3(z.x, z.y, z.z);
}

/**
 * Distances here carry no unit of their own: they are whatever the group the grid is added to
 * works in — parsecs in the galaxy view, AU in the system view.
 */
export interface PolarGridOptions {
  /** Ring radii to draw, innermost first. */
  readonly ringRadii: readonly number[];
  /** Radial spokes drawn from the innermost to the outermost ring. */
  readonly spokeCount: number;
  /**
   * Rotation from the grid's own XY plane onto the plane it should lie in. Defaults to the
   * galactic plane; the system view passes the frame its orbital elements were measured in.
   */
  readonly orientation?: THREE.Quaternion;
  /**
   * Centre of the grid, which also fixes the plane it lies in. Defaults to the origin — note
   * that in the galaxy view the origin is the Sun, whose own plane is
   * {@link SUN_HEIGHT_ABOVE_MIDPLANE_PC} above the Galaxy's midplane; that matters at the local
   * scale and is invisible at the galactic one.
   */
  readonly centre?: THREE.Vector3;
  readonly color?: THREE.ColorRepresentation;
  /** Rings listed here are drawn at full strength — used to call out a meaningful radius. */
  readonly emphasisRadii?: readonly number[];
  /** Peak opacity, for a grid that should read louder or quieter than the default. */
  readonly opacity?: number;
  /**
   * Breaks the rings into dashes. Worth it where the grid shares a plane with real curves it
   * could be mistaken for — the system view draws orbit ellipses in the same plane, and a solid
   * ring there is indistinguishable at a glance from a circular orbit. Dashed reads as
   * "reference", solid as "something is actually there".
   */
  readonly dashed?: boolean;
}

/** Ring segments per dash and per gap when {@link PolarGridOptions.dashed} is set. */
const DASH_SEGMENTS = 2;

/**
 * A polar grid lying in a reference plane: concentric rings and radial spokes, fading out with
 * radius.
 *
 * This is the one piece of chrome that makes a 3D map readable. Without a reference plane a
 * cloud of points has no depth at all — two stars a thousand parsecs apart look like neighbours,
 * and a planet above its system's plane looks like one inside it. With a plane under them, and a
 * tether from each down to it, the eye reads height directly. It is also the signature of the
 * map this view is modelled on.
 */
export class PolarGridPlane {
  readonly object: THREE.LineSegments;

  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.LineBasicMaterial;
  private readonly baseOpacity: number;

  constructor(options: PolarGridOptions) {
    const color = new THREE.Color(options.color ?? 0x4dd7ff);
    const emphasis = new Set(options.emphasisRadii ?? []);
    const outerRadius = Math.max(...options.ringRadii);
    const innerRadius = Math.min(...options.ringRadii);

    const vertices: number[] = [];
    const colors: number[] = [];

    const push = (x: number, y: number, brightness: number): void => {
      vertices.push(x, y, 0);
      colors.push(color.r * brightness, color.g * brightness, color.b * brightness);
    };

    for (const radius of options.ringRadii) {
      // Rings dim toward the edge of the grid so it dissolves into the void instead of ending.
      const brightness = emphasis.has(radius) ? 1 : 0.55 * (1 - (0.6 * radius) / outerRadius);
      for (let segment = 0; segment < SEGMENTS_PER_RING; segment++) {
        // Dashes are cut by dropping whole segments rather than by a dashed material: the ring is
        // already built from independent segment pairs, so a material's dash pattern would
        // restart at each one. Skipping segments also keeps the dash angular, so every ring is
        // dashed at the same rate however large it is.
        if (options.dashed && segment % (DASH_SEGMENTS * 2) >= DASH_SEGMENTS) {
          continue;
        }
        const a = (segment / SEGMENTS_PER_RING) * Math.PI * 2;
        const b = ((segment + 1) / SEGMENTS_PER_RING) * Math.PI * 2;
        push(Math.cos(a) * radius, Math.sin(a) * radius, brightness);
        push(Math.cos(b) * radius, Math.sin(b) * radius, brightness);
      }
    }

    for (let spoke = 0; spoke < options.spokeCount; spoke++) {
      const angle = (spoke / options.spokeCount) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      push(cos * innerRadius, sin * innerRadius, 0.4);
      push(cos * outerRadius, sin * outerRadius, 0.05);
    }

    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Deliberately restrained: the grid is the reference the map is read against, not the map.
    this.baseOpacity = options.opacity ?? 0.55;
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.object = new THREE.LineSegments(this.geometry, this.material);
    // Built flat in its own XY plane, then rotated onto the reference plane and slid to centre.
    this.object.quaternion.copy(options.orientation ?? galacticFrameQuaternion());
    this.object.position.copy(options.centre ?? new THREE.Vector3());
    this.object.visible = false;
    this.object.renderOrder = -1;
  }

  /** Crossfades the grid. Zero hides it outright rather than drawing a fully transparent pass. */
  setStrength(strength: number): void {
    const clamped = Math.max(0, Math.min(1, strength));
    this.material.opacity = clamped * this.baseOpacity;
    this.object.visible = clamped > 0;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The vertical lines dropped from objects onto the reference plane — the other half of what
 * makes the grid work. A point floating over a grid still has ambiguous height; a point with a
 * line down to a marked spot on the grid does not.
 *
 * Drawn as one `LineSegments` with a fixed-capacity buffer and a draw range, so following a
 * changing set of stars costs a buffer write rather than a rebuild.
 */
export class TetherField {
  readonly object: THREE.LineSegments;

  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.LineBasicMaterial;
  private readonly positions: Float32Array;
  private readonly maxCount: number;
  private readonly normal: THREE.Vector3;
  private readonly peakOpacity: number;

  constructor(maxCount: number, options: { color?: THREE.ColorRepresentation; normal?: THREE.Vector3; opacity?: number } = {}) {
    this.maxCount = maxCount;
    this.normal = (options.normal ?? galacticNormal()).clone().normalize();
    this.peakOpacity = options.opacity ?? 0.45;
    this.positions = new Float32Array(maxCount * 6);
    const color = options.color ?? 0x4dd7ff;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.object = new THREE.LineSegments(this.geometry, this.material);
    // The buffer is rewritten in place as the visible set changes, so its bounds are stale by
    // construction; culling on those bounds would blink the whole field in and out.
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  /**
   * Drops a tether from each point onto the plane through the origin with this field's normal,
   * offset along that normal by `planeOffset`.
   *
   * The offset is `0` for a plane through the origin — the Sun in the galaxy view, the host star
   * in the system view — and `-SUN_HEIGHT_ABOVE_MIDPLANE_PC` for a grid on the Galaxy's true
   * midplane. Points past the field's capacity are dropped.
   */
  setTargets(points: readonly THREE.Vector3[], planeOffset = 0): void {
    const normal = this.normal;
    const count = Math.min(points.length, this.maxCount);

    for (let index = 0; index < count; index++) {
      const point = points[index];
      const height = point.dot(normal) - planeOffset;
      this.positions.set(
        [point.x, point.y, point.z, point.x - normal.x * height, point.y - normal.y * height, point.z - normal.z * height],
        index * 6
      );
    }

    this.geometry.setDrawRange(0, count * 2);
    this.geometry.getAttribute('position').needsUpdate = true;
  }

  /** Crossfades the tethers, matching whichever grid they are dropping onto. */
  setStrength(strength: number): void {
    const clamped = Math.max(0, Math.min(1, strength));
    this.material.opacity = clamped * this.peakOpacity;
    this.object.visible = clamped > 0;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
