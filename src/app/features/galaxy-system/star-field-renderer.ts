import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, smoothstep, uv, vec2 } from 'three/tsl';

import { spectralTypeToColorIndex } from '../../shared/astro/spectral';
import { StarRecord } from '../../shared/models/star.model';

/** Apparent star diameters, in pixels at {@link REFERENCE_VIEWPORT_HEIGHT_PX}. */
const MIN_POINT_SIZE = 1.5;
const MAX_POINT_SIZE = 6;

/**
 * Star size is expressed in pixels for readability, but the material works in angular size, so
 * the two are related through the scene's vertical field of view and a reference viewport.
 * Because the size is angular, a star keeps the same share of the screen at any window size —
 * these pixel figures are exact only at this reference height.
 */
const REFERENCE_VIEWPORT_HEIGHT_PX = 900;
const REFERENCE_FOV_DEGREES = 55;
const PIXELS_TO_ANGULAR_SIZE =
  (2 * Math.tan((REFERENCE_FOV_DEGREES * Math.PI) / 180 / 2)) / REFERENCE_VIEWPORT_HEIGHT_PX;

/**
 * Extra click forgiveness added to a star's drawn radius, in NDC — roughly 4 px on the
 * reference viewport.
 *
 * Added rather than used as a floor. Stars are drawn 1.5-6 px across, so any floor generous
 * enough to make the faintest ones clickable would also exceed the brightest one's radius and
 * flatten every star to the same hit area. Adding keeps the ordering intact: a brighter star is
 * always the easier target, which is what the eye expects.
 */
const PICK_NDC_SLOP = 0.01;

const COLD_STAR_COLOR = new THREE.Color(0.65, 0.75, 1.0);
const NEUTRAL_STAR_COLOR = new THREE.Color(1.0, 1.0, 1.0);
const WARM_STAR_COLOR = new THREE.Color(1.0, 0.6, 0.35);

/**
 * Crude but effective B-V color-index -> RGB tint: hot/blue stars (low/negative index) skew
 * blue-white, cool/red stars (high index) skew orange-red, matching real spectral colors.
 *
 * `colorIndex` is `null` for the ~10% of stars HYG never photometered. Those fall back to a
 * value derived from `spectralType`, and to neutral white only when the catalog records no
 * classification at all — never to 0, which is itself a real color index meaning "hot A-type"
 * and would paint several hundred red dwarfs blue-white.
 */
export function colorIndexToRgb(colorIndex: number | null, spectralType?: string): THREE.Color {
  const resolved = colorIndex ?? spectralTypeToColorIndex(spectralType);
  const color = new THREE.Color();
  if (resolved === null) {
    return color.copy(NEUTRAL_STAR_COLOR);
  }

  const t = THREE.MathUtils.clamp((resolved + 0.4) / 2.4, 0, 1);
  return t < 0.5 ? color.lerpColors(COLD_STAR_COLOR, NEUTRAL_STAR_COLOR, t * 2) : color.lerpColors(NEUTRAL_STAR_COLOR, WARM_STAR_COLOR, (t - 0.5) * 2);
}

/** Brighter stars (lower apparent magnitude) render as bigger points. */
export function magnitudeToPointSize(magnitude: number): number {
  const t = THREE.MathUtils.clamp(1 - (magnitude + 2) / 12, 0, 1);
  return MIN_POINT_SIZE + t * (MAX_POINT_SIZE - MIN_POINT_SIZE);
}

/** A unit quad centred on the origin — the billboard every star instance is drawn on. */
function createQuadGeometry(instanceCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = instanceCount;
  return geometry;
}

/**
 * Builds the galaxy-scale star field as instanced camera-facing billboards, one per HYG star,
 * coloured by spectral index and sized by magnitude.
 *
 * **Why billboards and not `THREE.Points`.** Point primitives are capped at a single pixel on
 * the WebGPU backend — which is the renderer this app targets — so a points cloud rendered
 * every star as an identical 1 px dot no matter what `sizeNode` said, discarding both the
 * magnitude sizing and any glow. Instanced quads render identically on both backends.
 *
 * `SpriteNodeMaterial` takes each instance's centre from `positionNode` rather than from an
 * instance matrix (see its own documentation), so the per-star data rides on instanced buffer
 * attributes and the mesh itself never moves.
 *
 * Sizes are angular (`sizeAttenuation = false`), so a star holds the same apparent size however
 * close the camera gets. That is deliberate and physically right: real stars are unresolvable
 * point sources, and their apparent size on screen is a function of brightness, not distance.
 */
export class StarFieldRenderer {
  readonly object: THREE.Mesh;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.SpriteNodeMaterial;
  /** Angular diameter per star, in the same order as `stars` — reused for picking. */
  private readonly angularSizes: Float32Array;

  constructor(
    private readonly stars: readonly StarRecord[],
    positions: Float32Array
  ) {
    this.geometry = createQuadGeometry(stars.length);

    const colors = new Float32Array(stars.length * 3);
    this.angularSizes = new Float32Array(stars.length);

    stars.forEach((star, index) => {
      const color = colorIndexToRgb(star.colorIndex, star.spectralType);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      this.angularSizes[index] = magnitudeToPointSize(star.magnitude) * PIXELS_TO_ANGULAR_SIZE;
    });

    // `positions` is the ETL's packed buffer, already in the same order as `stars`.
    const positionAttribute = new THREE.InstancedBufferAttribute(positions, 3);
    const colorAttribute = new THREE.InstancedBufferAttribute(colors, 3);
    const sizeAttribute = new THREE.InstancedBufferAttribute(this.angularSizes, 1);

    this.material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.material.sizeAttenuation = false;
    this.material.positionNode = instancedBufferAttribute(positionAttribute, 'vec3');
    this.material.scaleNode = instancedBufferAttribute(sizeAttribute, 'float');
    this.material.colorNode = instancedBufferAttribute(colorAttribute, 'vec3');
    // Soft radial falloff so each star is a small bright core inside a halo, rather than a
    // hard-edged square. `uv` runs 0..1 across the quad, so 0.5 is its centre.
    const radius = uv().sub(vec2(0.5)).length();
    this.material.opacityNode = smoothstep(0.0, 0.5, radius).oneMinus().pow(2.0);

    this.object = new THREE.Mesh(this.geometry, this.material);
    // The quad's own bounds sit at the origin and say nothing about where the instances are,
    // so leaving culling on would drop the whole field whenever the origin left the frustum.
    this.object.frustumCulled = false;
  }

  /** Looks up the HYG star id for a given instance index. */
  starIdAt(instanceIndex: number): number | undefined {
    return this.stars[instanceIndex]?.id;
  }

  /**
   * The star under `pointerNdc`, or `undefined`.
   *
   * Billboarding happens in the vertex shader, so the CPU-side geometry is a single quad at the
   * origin and `Raycaster` cannot see the star field at all. Picking is therefore done in screen
   * space, which is also strictly better than the fixed world-space radius the points cloud
   * needed: each star is tested against the size it is actually drawn at, so the hit area matches
   * what the user sees at every zoom level instead of being over-permissive up close and
   * sub-pixel at the far end of the camera's range.
   */
  pickAt(pointerNdc: THREE.Vector2, camera: THREE.PerspectiveCamera): number | undefined {
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
    const projected = new THREE.Vector3();

    let bestIndex: number | undefined;
    let bestScore = Infinity;

    for (let index = 0; index < this.stars.length; index++) {
      const star = this.stars[index];
      projected.set(star.x, star.y, star.z).project(camera);
      // Outside the depth range means behind the camera or beyond the far plane; `project`
      // mirrors points behind the camera onto the screen, so this guard is load-bearing.
      if (projected.z < -1 || projected.z > 1) {
        continue;
      }

      // A sprite square in view space projects to an ellipse in NDC: the same half-extent in y,
      // divided by the aspect ratio in x. Scaling dx by the aspect makes the comparison circular.
      const ndcRadius = (0.5 * this.angularSizes[index]) / tanHalfFov + PICK_NDC_SLOP;
      const dx = (projected.x - pointerNdc.x) * camera.aspect;
      const dy = projected.y - pointerNdc.y;
      const score = Math.hypot(dx, dy) / ndcRadius;

      if (score <= 1 && score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    return bestIndex === undefined ? undefined : this.stars[bestIndex].id;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
