import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';

import { StarRecord } from '../../shared/models/star.model';

const MIN_POINT_SIZE = 1.5;
const MAX_POINT_SIZE = 6;

const COLD_STAR_COLOR = new THREE.Color(0.65, 0.75, 1.0);
const NEUTRAL_STAR_COLOR = new THREE.Color(1.0, 1.0, 1.0);
const WARM_STAR_COLOR = new THREE.Color(1.0, 0.6, 0.35);

/**
 * Crude but effective B-V color-index -> RGB tint: hot/blue stars (low/negative index) skew
 * blue-white, cool/red stars (high index) skew orange-red, matching real spectral colors.
 */
export function colorIndexToRgb(colorIndex: number): THREE.Color {
  const t = THREE.MathUtils.clamp((colorIndex + 0.4) / 2.4, 0, 1);
  const color = new THREE.Color();
  return t < 0.5 ? color.lerpColors(COLD_STAR_COLOR, NEUTRAL_STAR_COLOR, t * 2) : color.lerpColors(NEUTRAL_STAR_COLOR, WARM_STAR_COLOR, (t - 0.5) * 2);
}

/** Brighter stars (lower apparent magnitude) render as bigger points. */
function magnitudeToPointSize(magnitude: number): number {
  const t = THREE.MathUtils.clamp(1 - (magnitude + 2) / 12, 0, 1);
  return MIN_POINT_SIZE + t * (MAX_POINT_SIZE - MIN_POINT_SIZE);
}

/**
 * Builds a `THREE.Points` field from the ETL-generated star positions/index, using a TSL
 * `PointsNodeMaterial` whose color/size are driven by per-vertex attributes derived from
 * each star's spectral color index and magnitude.
 *
 * Note: per the Three.js WebGPU backend, point primitives are capped at 1px on native
 * WebGPU — `sizeNode` only has a visible effect when `WebGPURenderer` has fallen back to
 * its WebGL2 backend. Color variation works on both backends.
 */
export class StarFieldRenderer {
  readonly object: THREE.Points;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsNodeMaterial;

  constructor(private readonly stars: readonly StarRecord[], positions: Float32Array) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const colors = new Float32Array(stars.length * 3);
    const sizes = new Float32Array(stars.length);

    stars.forEach((star, index) => {
      const color = colorIndexToRgb(star.colorIndex);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = magnitudeToPointSize(star.magnitude);
    });

    this.geometry.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));

    this.material = new THREE.PointsNodeMaterial({
      colorNode: attribute('starColor', 'vec3'),
      sizeNode: attribute('starSize', 'float'),
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false
    });

    this.object = new THREE.Points(this.geometry, this.material);
  }

  /** Looks up the HYG star id for a given geometry vertex index (e.g. from a raycast hit). */
  starIdAt(vertexIndex: number): number | undefined {
    return this.stars[vertexIndex]?.id;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
