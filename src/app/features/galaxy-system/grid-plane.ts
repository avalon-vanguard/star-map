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

export interface PolarGridOptions {
  /** Ring radii to draw, in parsecs, innermost first. */
  readonly ringRadiiPc: readonly number[];
  /** Radial spokes drawn from the innermost to the outermost ring. */
  readonly spokeCount: number;
  /**
   * Centre of the grid in the scene's equatorial frame, which also fixes the plane it lies in.
   * Defaults to the Sun (the origin) — note that the Sun's own plane is
   * {@link SUN_HEIGHT_ABOVE_MIDPLANE_PC} above the Galaxy's midplane, which matters at the local
   * scale and is invisible at the galactic one.
   */
  readonly centrePc?: THREE.Vector3;
  readonly color?: THREE.ColorRepresentation;
  /** Rings listed here are drawn at full strength — used to call out a meaningful radius. */
  readonly emphasisRadiiPc?: readonly number[];
}

/**
 * A polar grid lying in the galactic plane: concentric rings and radial spokes, fading out with
 * radius.
 *
 * This is the one piece of chrome that makes a 3D star map readable. Without a reference plane
 * a cloud of points has no depth at all — two stars a thousand parsecs apart look like
 * neighbours. With a plane under them, and a tether from each to the plane, the eye reads their
 * height directly. It is also the signature of the map this view is modelled on.
 */
export class PolarGridPlane {
  readonly object: THREE.LineSegments;

  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.LineBasicMaterial;
  private readonly baseOpacity: number;

  constructor(options: PolarGridOptions) {
    const color = new THREE.Color(options.color ?? 0x4dd7ff);
    const emphasis = new Set(options.emphasisRadiiPc ?? []);
    const outerRadius = Math.max(...options.ringRadiiPc);
    const innerRadius = Math.min(...options.ringRadiiPc);

    const vertices: number[] = [];
    const colors: number[] = [];

    const push = (x: number, y: number, brightness: number): void => {
      vertices.push(x, y, 0);
      colors.push(color.r * brightness, color.g * brightness, color.b * brightness);
    };

    for (const radius of options.ringRadiiPc) {
      // Rings dim toward the edge of the grid so it dissolves into the void instead of ending.
      const brightness = emphasis.has(radius) ? 1 : 0.55 * (1 - (0.6 * radius) / outerRadius);
      for (let segment = 0; segment < SEGMENTS_PER_RING; segment++) {
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
    this.baseOpacity = 0.55;
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.object = new THREE.LineSegments(this.geometry, this.material);
    // Built flat in its own XY plane, then rotated onto the galactic plane and slid to centre.
    this.object.quaternion.copy(galacticFrameQuaternion());
    this.object.position.copy(options.centrePc ?? new THREE.Vector3());
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

  constructor(maxCount: number, color: THREE.ColorRepresentation = 0x4dd7ff) {
    this.maxCount = maxCount;
    this.positions = new Float32Array(maxCount * 6);
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
   * Drops a tether from each point onto a plane parallel to the galactic plane.
   *
   * `planeHeightPc` is that plane's height above the Sun along the galactic normal, so it is `0`
   * for a grid through the Sun and `-SUN_HEIGHT_ABOVE_MIDPLANE_PC` for one on the Galaxy's true
   * midplane. Points past the field's capacity are dropped.
   */
  setTargets(points: readonly THREE.Vector3[], planeHeightPc = 0): void {
    const normal = galacticNormal();
    const count = Math.min(points.length, this.maxCount);

    for (let index = 0; index < count; index++) {
      const point = points[index];
      const height = point.dot(normal) - planeHeightPc;
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
    this.material.opacity = clamped * 0.45;
    this.object.visible = clamped > 0;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
