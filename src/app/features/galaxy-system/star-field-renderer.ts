import * as THREE from 'three/webgpu';
import { float, instancedBufferAttribute, mix, modelViewMatrix, smoothstep, uniform, uv, vec2, vec4 } from 'three/tsl';

import { spectralTypeToColorIndex } from '../../shared/astro/spectral';
import { SceneCamera } from '../../core/engine/engine.service';
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

/**
 * How many stars the field draws at once, however many the catalogue holds.
 *
 * The catalogue reaches as far as its parallaxes do — 68388 stars at 250 pc — but drawing all of
 * them is a cost paid every frame by every machine, and most of that cost buys 1.5-pixel dots.
 * So the *data* is the catalogue and the *drawing* is a budget, and the two are allowed to
 * differ. Everything still exists for search, for flying to, and for hosting planets.
 *
 * Currently set to the whole catalogue, which is what a GPU should be asked to do — this is one
 * instanced draw call, and a discrete card will not notice it. The budget still exists because
 * the catalogue is meant to grow past what any machine should draw at once: Gaia alone could
 * contribute a million stars, and at that point the selection below is what keeps the field
 * legible rather than a grey wash.
 *
 * Machines without a GPU do feel it. A software rasterizer measured here lost about a third of
 * its frame rate per 12000 stars drawn; if that matters for a deployment, this is the one number
 * to turn down.
 */
export const STAR_RENDER_BUDGET = 68388;

/**
 * Radius (parsecs) inside which every star is drawn regardless of brightness.
 *
 * A pure brightness cut would be defensible — apparent magnitude is exactly "how visible this
 * is" — but it would drop the solar neighbourhood, because the nearest stars are overwhelmingly
 * faint red dwarfs. Proxima Centauri is magnitude 11. Those are the stars this map is most about
 * and the ones that hold the nearby planets, so the neighbourhood is kept whole and the budget
 * is spent on the brightest of everything beyond it.
 *
 * Kept deliberately small against the catalogue's 250 pc reach. The guaranteed core occupies a
 * thousandth of that volume, so a generous radius spends most of the budget inside it and draws
 * a dense knot surrounded by nothing — which is a worse picture than the smaller catalogue was.
 */
export const ALWAYS_DRAWN_RADIUS_PC = 25;

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
/**
 * Chooses which stars to draw when the catalogue is larger than the budget: everything inside
 * the neighbourhood radius, then the brightest of the rest until the budget is spent.
 *
 * Returns indices into the original list, so the caller can subset the positions that go with
 * them. Returns them in catalogue order rather than in selection order, purely so the drawn set
 * is stable and inspectable.
 */
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

export function selectDrawnStars(stars: readonly StarRecord[], budget = STAR_RENDER_BUDGET): Uint32Array {
  if (stars.length <= budget) {
    return Uint32Array.from(stars.keys());
  }

  const near: number[] = [];
  const far: number[] = [];
  stars.forEach((star, index) => {
    (Math.hypot(star.x, star.y, star.z) <= ALWAYS_DRAWN_RADIUS_PC ? near : far).push(index);
  });

  far.sort((a, b) => stars[a].magnitude - stars[b].magnitude);
  const selected = near.concat(far.slice(0, Math.max(0, budget - near.length)));
  selected.sort((a, b) => a - b);
  return Uint32Array.from(selected);
}

export class StarFieldRenderer {
  readonly object: THREE.Mesh;
  /** How many of the catalogue's stars this field actually draws. */
  readonly drawnCount: number;

  /** 1 under a perspective camera, 0 under an orthographic one. See `setProjection`. */
  private readonly perspective = uniform(1);
  private readonly orthographicScale = uniform(float(0));

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.SpriteNodeMaterial;
  /** The subset of the catalogue that is drawn, and so the only set that can be clicked. */
  private readonly stars: readonly StarRecord[];
  /** Angular diameter per drawn star, in the same order as `stars` — reused for picking. */
  private readonly angularSizes: Float32Array;

  constructor(catalogue: readonly StarRecord[], cataloguePositions: Float32Array, budget = STAR_RENDER_BUDGET) {
    const drawn = selectDrawnStars(catalogue, budget);
    this.stars = drawn.length === catalogue.length ? catalogue : Array.from(drawn, (index) => catalogue[index]);
    this.drawnCount = this.stars.length;

    const stars = this.stars;
    this.geometry = createQuadGeometry(stars.length);

    const colors = new Float32Array(stars.length * 3);
    this.angularSizes = new Float32Array(stars.length);
    // Repacked only when the drawn set is a subset; otherwise the ETL's buffer is used as-is.
    const positions =
      drawn.length === catalogue.length
        ? cataloguePositions
        : Float32Array.from({ length: drawn.length * 3 }, (_, i) => cataloguePositions[drawn[(i / 3) | 0] * 3 + (i % 3)]);

    stars.forEach((star, index) => {
      const color = colorIndexToRgb(star.colorIndex, star.spectralType);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      this.angularSizes[index] = magnitudeToPointSize(star.magnitude) * PIXELS_TO_ANGULAR_SIZE;
    });

    const positionAttribute = new THREE.InstancedBufferAttribute(positions, 3);
    const colorAttribute = new THREE.InstancedBufferAttribute(colors, 3);
    const sizeAttribute = new THREE.InstancedBufferAttribute(this.angularSizes, 1);

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
    const position = instancedBufferAttribute<'vec3'>(positionAttribute, 'vec3');
    const angularSize = instancedBufferAttribute<'float'>(sizeAttribute, 'float');
    this.material.positionNode = position;
    // Perspective: a star's world size is its angular size times how far away it is, which is
    // exactly what the built-in does. Orthographic: distance does not set apparent size at all,
    // the frustum does, so the same angular size is scaled by the frustum instead.
    const viewDepth = modelViewMatrix.mul(vec4(position, 1)).z.negate();
    this.material.scaleNode = angularSize.mul(mix(this.orthographicScale, viewDepth, this.perspective));
    this.material.colorNode = instancedBufferAttribute<'vec3'>(colorAttribute, 'vec3');
    // Soft radial falloff so each star is a small bright core inside a halo, rather than a
    // hard-edged square. `uv` runs 0..1 across the quad, so 0.5 is its centre.
    const radius = uv().sub(vec2(0.5)).length();
    this.material.opacityNode = smoothstep(0.0, 0.5, radius).oneMinus().pow(2.0);

    this.object = new THREE.Mesh(this.geometry, this.material);
    // The quad's own bounds sit at the origin and say nothing about where the instances are,
    // so leaving culling on would drop the whole field whenever the origin left the frustum.
    this.object.frustumCulled = false;
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
  pickAt(pointerNdc: THREE.Vector2, camera: SceneCamera, aspect: number): number | undefined {
    // What a unit of angular size is worth on screen. Under perspective that is set by the
    // field of view; under an orthographic camera the same size was already turned into a world
    // size by `setProjection`, so it is the frustum that converts it back.
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    const orthographic = camera as THREE.OrthographicCamera;
    const halfHeightWorld = perspective ? 0 : (orthographic.top - orthographic.bottom) / (2 * orthographic.zoom);
    const tanHalfFov = perspective ? Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360) : 0;
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
      const ndcRadius =
        (perspective
          ? (0.5 * this.angularSizes[index]) / tanHalfFov
          : // The world size the star is drawn at, as a fraction of the frustum's half-height.
            (0.5 * this.angularSizes[index] * (halfHeightWorld / Math.tan((REFERENCE_FOV_DEGREES * Math.PI) / 360))) / halfHeightWorld) + PICK_NDC_SLOP;
      const dx = (projected.x - pointerNdc.x) * aspect;
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
