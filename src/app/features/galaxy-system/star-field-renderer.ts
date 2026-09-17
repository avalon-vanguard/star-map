import * as THREE from 'three/webgpu';
import { float, instancedBufferAttribute, mix, modelViewMatrix, smoothstep, uniform, uv, vec2, vec4 } from 'three/tsl';

import { BrightnessIndex, brightnessIndex, Positioned } from '../../shared/astro/brightest';
import { spectralTypeToColorIndex } from '../../shared/astro/spectral';
import { SceneCamera } from '../../core/engine/engine.service';
import { StarRecord } from '../../shared/models/star.model';
import { PIXELS_TO_ANGULAR_SIZE, REFERENCE_FOV_DEGREES, REFERENCE_VIEWPORT_HEIGHT_PX } from './angular-size';

/** Apparent star diameters, in pixels at {@link REFERENCE_VIEWPORT_HEIGHT_PX}. */
const MIN_POINT_SIZE = 1.5;
const MAX_POINT_SIZE = 6;


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

/**
 * How many stars the field draws at once, however many the catalogue holds.
 *
 * The *data* is the catalogue and the *drawing* is a budget, and the two are allowed to differ:
 * everything still exists for search, for flying to, and for hosting planets. Which stars fill
 * the budget follows the view; see {@link selectDrawnStars}.
 *
 * The number is set by what the field looks like, before what it costs. The catalogue is
 * 423 651 stars since Gaia, and drawn whole the opening view is a grey wash: the additive
 * blending of that many 1.5-pixel dots buries the labels, the rings on the planet hosts and the
 * grid. At 150 000 the wash has begun; at this budget the view reads. Measured at 1920 × 1080 on
 * a Ryzen 7700X, the cost argues the same way. An RTX 4080 draws the whole catalogue in the same
 * 6.1 ms a frame as this budget, so a discrete card does not notice. The processor's own
 * two-core Radeon, standing in for an entry-level laptop, pays about 4 ms a frame for every
 * 100 000 stars: 112 frames a second at this budget, 44 at the whole catalogue, and the same
 * again under the WebGL2 fallback.
 */
export const STAR_RENDER_BUDGET = 70_000;

/**
 * Radius (parsecs) around the Sun, and around wherever the view is centred, inside which every
 * star is drawn regardless of brightness.
 *
 * A pure brightness cut would be defensible — apparent magnitude is exactly "how visible this
 * is" — but it would drop the solar neighbourhood, because the nearest stars are overwhelmingly
 * faint red dwarfs. Proxima Centauri is magnitude 11. Those are the stars this map is most about
 * and the ones that hold the nearby planets, so the neighbourhood is kept whole and the budget
 * is spent on the brightest of everything beyond it.
 *
 * The same holds wherever the view is looking. Before the drawn set followed the view, a region
 * 150 pc out drew 49 of the 442 stars within this radius of it, and a route plotted there ran
 * through waypoints nobody could see or click: Sol to Almach at 8 pc passed 19 stars and drew 6.
 *
 * Kept deliberately small against the catalogue's reach. Around the Sun it holds 3 654 stars;
 * a generous radius spends most of the budget inside it and draws a dense knot surrounded by
 * nothing.
 */
export const FOCUS_RADIUS_PC = 25;

/** What, besides the brightest stars, the field should be sure to draw. */
export interface DrawFocus {
  /** Where the view is centred. Its neighbourhood is drawn whole, like the Sun's. */
  readonly centre?: Positioned;
  /**
   * Catalogue indices drawn wherever they are and however faint: the selected star, the stars
   * of a plotted route. Anything the map points at has to be there to be pointed at.
   */
  readonly pinned?: readonly number[];
}

const SUN: Positioned = { x: 0, y: 0, z: 0 };

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
 * Reads a render budget override off the page URL (`?stars=20000`), falling back to the default.
 *
 * Two uses, one real and one incidental. The real one is a deployment or a machine that cannot
 * draw the whole catalogue — a number in a URL beats a rebuild. The incidental one is the
 * end-to-end suite, which runs against a software rasterizer whose frame rate is two orders of
 * magnitude below a real GPU's: those tests are checking navigation and state, and making them
 * wait on a rasterizer measures nothing about the app.
 */
export function starRenderBudgetFromUrl(search: string, fallback = STAR_RENDER_BUDGET): number {
  const requested = Number(new URLSearchParams(search).get('stars'));
  return Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : fallback;
}

/**
 * Chooses which stars to draw when the catalogue is larger than the budget. In order, until the
 * budget is spent: the pinned stars, everything within {@link FOCUS_RADIUS_PC} of where the view
 * is centred, everything within it of the Sun, then the brightest of the rest. Each neighbourhood
 * is taken brightest first, so a budget too small to hold one whole keeps its most visible part.
 *
 * Returns indices into the original list, in the order they were chosen. `index` is the
 * catalogue's brightness index, passed in when the caller already has it rather than sorted again
 * on every call.
 */
export function selectDrawnStars(
  stars: readonly StarRecord[],
  budget = STAR_RENDER_BUDGET,
  focus: DrawFocus = {},
  index: BrightnessIndex = brightnessIndex(stars)
): Uint32Array {
  if (stars.length <= budget) {
    return Uint32Array.from(stars.keys());
  }

  // One walk of the brightness order, reading positions laid out in that order, sorts each tier
  // brightest first as it goes: 2.4-3.1 ms on the real catalogue in Node, against 6.4-8.5 ms
  // gathering both neighbourhoods in catalogue order and sorting them. Beyond both neighbourhoods
  // only the first `budget` stars can ever be taken, so past those it only looks for members.
  const { order, positions } = index;
  const radiusSq = FOCUS_RADIUS_PC * FOCUS_RADIUS_PC;
  const centre = focus.centre ?? SUN;
  const nearCentre: number[] = [];
  const nearSun: number[] = [];
  const rest: number[] = [];
  for (let at = 0; at < order.length; at++) {
    const x = positions[at * 3];
    const y = positions[at * 3 + 1];
    const z = positions[at * 3 + 2];
    const dx = x - centre.x;
    const dy = y - centre.y;
    const dz = z - centre.z;
    if (dx * dx + dy * dy + dz * dz <= radiusSq) {
      nearCentre.push(order[at]);
    } else if (x * x + y * y + z * z <= radiusSq) {
      nearSun.push(order[at]);
    } else if (rest.length < budget) {
      rest.push(order[at]);
    }
  }

  const chosen = new Uint8Array(stars.length);
  const selected: number[] = [];
  const take = (index: number): void => {
    if (!chosen[index] && selected.length < budget) {
      chosen[index] = 1;
      selected.push(index);
    }
  };
  for (const pinned of focus.pinned ?? []) {
    if (pinned >= 0 && pinned < stars.length) {
      take(pinned);
    }
  }
  nearCentre.forEach(take);
  nearSun.forEach(take);
  rest.forEach(take);
  return Uint32Array.from(selected);
}

/**
 * Builds the galaxy-scale star field as instanced camera-facing billboards, one per drawn star,
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
 *
 * The instance buffers hold the budget, not the catalogue, and are rewritten in place when
 * {@link refocus} changes which stars fill it.
 */
export class StarFieldRenderer {
  readonly object: THREE.Mesh;

  /** 1 under a perspective camera, 0 under an orthographic one. See `setProjection`. */
  private readonly perspective = uniform(1);
  private readonly orthographicScale = uniform(float(0));

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly budget: number;
  private readonly brightness: BrightnessIndex;
  /**
   * Colour and angular size of every star in the catalogue, worked out once: a refocus then only
   * copies them into the instances, 0.7 ms for the budget rather than 5.6 ms computing them again.
   */
  private readonly catalogueColors: Float32Array;
  private readonly catalogueSizes: Float32Array;

  /** Per-instance data, `budget` long; the first `drawnCount` entries are live. */
  private readonly positionAttribute: THREE.InstancedBufferAttribute;
  private readonly colorAttribute: THREE.InstancedBufferAttribute;
  private readonly sizeAttribute: THREE.InstancedBufferAttribute;
  /** Catalogue index behind each live instance: the set that is drawn, and so the only set that can be clicked. */
  private drawn: Uint32Array = new Uint32Array(0);

  constructor(
    private readonly catalogue: readonly StarRecord[],
    private readonly cataloguePositions: Float32Array,
    budget = STAR_RENDER_BUDGET,
    brightness?: BrightnessIndex
  ) {
    this.budget = budget;
    this.brightness = brightness ?? brightnessIndex(catalogue);
    const capacity = Math.min(budget, catalogue.length);
    this.geometry = createQuadGeometry(0);

    this.positionAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.colorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.sizeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);

    this.catalogueColors = new Float32Array(catalogue.length * 3);
    this.catalogueSizes = new Float32Array(catalogue.length);
    catalogue.forEach((star, index) => {
      const color = colorIndexToRgb(star.colorIndex, star.spectralType);
      this.catalogueColors[index * 3] = color.r;
      this.catalogueColors[index * 3 + 1] = color.g;
      this.catalogueColors[index * 3 + 2] = color.b;
      this.catalogueSizes[index] = magnitudeToPointSize(star.magnitude) * PIXELS_TO_ANGULAR_SIZE;
    });

    this.material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    // The compensation that turns an angular size into a world size is done here rather than by
    // `sizeAttenuation: false`, which three.js applies only when it is compiling against a
    // perspective camera (SpriteNodeMaterial.js: `camera.isPerspectiveCamera && sizeAttenuation
    // === false`). Under an orthographic one it is silently skipped and every star collapses to
    // a thousandth of a parsec — invisible. Doing the same arithmetic in the node graph, behind
    // a uniform, lets one material serve both cameras without being recompiled between them.
    this.material.sizeAttenuation = true;
    const position = instancedBufferAttribute<'vec3'>(this.positionAttribute, 'vec3');
    const angularSize = instancedBufferAttribute<'float'>(this.sizeAttribute, 'float');
    this.material.positionNode = position;
    // Perspective: a star's world size is its angular size times how far away it is, which is
    // exactly what the built-in does. Orthographic: distance does not set apparent size at all,
    // the frustum does, so the same angular size is scaled by the frustum instead.
    const viewDepth = modelViewMatrix.mul(vec4(position, 1)).z.negate();
    this.material.scaleNode = angularSize.mul(mix(this.orthographicScale, viewDepth, this.perspective));
    this.material.colorNode = instancedBufferAttribute<'vec3'>(this.colorAttribute, 'vec3');
    // Soft radial falloff so each star is a small bright core inside a halo, rather than a
    // hard-edged square. `uv` runs 0..1 across the quad, so 0.5 is its centre.
    const radius = uv().sub(vec2(0.5)).length();
    this.material.opacityNode = smoothstep(0.0, 0.5, radius).oneMinus().pow(2.0);

    this.object = new THREE.Mesh(this.geometry, this.material);
    // The quad's own bounds sit at the origin and say nothing about where the instances are,
    // so leaving culling on would drop the whole field whenever the origin left the frustum.
    this.object.frustumCulled = false;

    this.refocus({});
  }

  /** How many of the catalogue's stars this field is drawing. */
  get drawnCount(): number {
    return this.drawn.length;
  }

  /**
   * The catalogue indices being drawn. Replaced by a refocus that changes them, never changed in
   * place, so the same array means the same stars.
   */
  get drawnStars(): Uint32Array {
    return this.drawn;
  }

  /**
   * Chooses the drawn stars again for where the view now is, and rewrites the instance buffers
   * with them. See {@link selectDrawnStars}.
   */
  refocus(focus: DrawFocus): void {
    const drawn = selectDrawnStars(this.catalogue, this.budget, focus, this.brightness);
    // The same stars in the same instances: the buffers already hold them, and a rewrite would
    // upload 2 MB to the GPU for nothing — which a pan across empty space would do every pass.
    if (drawn.length === this.drawn.length && drawn.every((index, instance) => index === this.drawn[instance])) {
      return;
    }
    this.drawn = drawn;

    const positions = this.positionAttribute.array as Float32Array;
    const colors = this.colorAttribute.array as Float32Array;
    const sizes = this.sizeAttribute.array as Float32Array;
    this.drawn.forEach((catalogueIndex, instance) => {
      for (let axis = 0; axis < 3; axis++) {
        positions[instance * 3 + axis] = this.cataloguePositions[catalogueIndex * 3 + axis];
        colors[instance * 3 + axis] = this.catalogueColors[catalogueIndex * 3 + axis];
      }
      sizes[instance] = this.catalogueSizes[catalogueIndex];
    });

    this.geometry.instanceCount = this.drawn.length;
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
  }

  /**
   * Tells the field which projection it is being drawn under.
   *
   * `halfHeightWorld` is half the orthographic frustum's height in world units; `null` means a
   * perspective camera, where a star's distance sets its apparent size on its own.
   */
  setProjection(halfHeightWorld: number | null): void {
    this.perspective.value = halfHeightWorld === null ? 1 : 0;
    // The world size that subtends the same share of the viewport an angular size would under
    // the reference field of view: `angular * halfHeight / tan(fov/2)`.
    this.orthographicScale.value = halfHeightWorld === null ? 0 : halfHeightWorld / Math.tan((REFERENCE_FOV_DEGREES * Math.PI) / 360);
  }

  /** Looks up the star id for a given instance index. */
  starIdAt(instanceIndex: number): number | undefined {
    return instanceIndex >= 0 && instanceIndex < this.drawn.length ? this.catalogue[this.drawn[instanceIndex]].id : undefined;
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
  pickAt(pointerNdc: THREE.Vector2, camera: SceneCamera, aspect: number): number | undefined {
    // What a unit of angular size is worth on screen. Under perspective the field of view sets
    // it. Under an orthographic camera the frustum does — but `setProjection` sized the sprite
    // as `angular * halfHeight / tan(REFERENCE_FOV/2)` in the first place, so dividing back out
    // by that same half-height leaves the reference field of view and nothing else. Both cases
    // are therefore one formula over a different angle.
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    const tanHalfFov = Math.tan(((perspective ? (camera as THREE.PerspectiveCamera).fov : REFERENCE_FOV_DEGREES) * Math.PI) / 360);
    const projected = new THREE.Vector3();
    const positions = this.positionAttribute.array as Float32Array;
    const sizes = this.sizeAttribute.array as Float32Array;

    let bestIndex: number | undefined;
    let bestScore = Infinity;

    for (let index = 0; index < this.drawn.length; index++) {
      projected.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]).project(camera);
      // Outside the depth range means behind the camera or beyond the far plane; `project`
      // mirrors points behind the camera onto the screen, so this guard is load-bearing.
      if (projected.z < -1 || projected.z > 1) {
        continue;
      }

      // A sprite square in view space projects to an ellipse in NDC: the same half-extent in y,
      // divided by the aspect ratio in x. Scaling dx by the aspect makes the comparison circular.
      const ndcRadius = (0.5 * sizes[index]) / tanHalfFov + PICK_NDC_SLOP;
      const dx = (projected.x - pointerNdc.x) * aspect;
      const dy = projected.y - pointerNdc.y;
      const score = Math.hypot(dx, dy) / ndcRadius;

      if (score <= 1 && score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    return bestIndex === undefined ? undefined : this.starIdAt(bestIndex);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
