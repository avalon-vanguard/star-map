import * as THREE from 'three/webgpu';
import { color, float, instancedBufferAttribute, smoothstep, uniform, uv, vec2 } from 'three/tsl';

import { StarRecord } from '../../shared/models/star.model';
import { PIXELS_TO_ANGULAR_SIZE } from './angular-size';

/** Ring diameter in screen pixels at the reference viewport — angular, like the star points. */
const RING_SIZE_PX = 12;
const RING_PEAK_OPACITY = 0.35;
/** Ring radius and stroke half-width in quad-uv units (the quad runs 0..1, centre 0.5). */
const RING_RADIUS_UV = 0.42;
const RING_STROKE_UV = 0.06;

/** A unit quad centred on the origin — the billboard every ring instance is drawn on. */
function createQuadGeometry(instanceCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = instanceCount;
  return geometry;
}

/**
 * A faint accent ring around every star known to host planets: the one binary fact about a
 * point of light worth reading at a glance from the neighbourhood view, since it is the one
 * thing that says "there is somewhere to go here".
 *
 * Drawn the way the star field draws its stars — instanced unattenuated sprites — so the rings
 * sit exactly on the field's own points at any zoom and window size. The ring itself is a band
 * of the quad's uv distance from centre, not a texture, so it stays a hairline at any scale.
 */
export class HostStarRings {
  readonly object: THREE.Mesh;
  readonly count: number;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly opacity = uniform(RING_PEAK_OPACITY);

  constructor(hosts: readonly StarRecord[], accent: number) {
    const positions = new Float32Array(hosts.length * 3);
    hosts.forEach((star, i) => positions.set([star.x, star.y, star.z], i * 3));
    this.geometry = createQuadGeometry(hosts.length);

    this.material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    this.material.sizeAttenuation = false;
    this.material.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(positions, 3), 'vec3');
    this.material.scaleNode = float(RING_SIZE_PX * PIXELS_TO_ANGULAR_SIZE);
    this.material.colorNode = color(accent);
    // Opaque on the ring's centreline, falling to nothing one stroke-width either side.
    const distanceFromRing = uv().sub(vec2(0.5)).length().sub(RING_RADIUS_UV).abs();
    this.material.opacityNode = smoothstep(RING_STROKE_UV, 0.0, distanceFromRing).mul(this.opacity);

    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = 'host-star-rings';
    // As for the star field: the quad's bounds say nothing about where the instances are.
    this.object.frustumCulled = false;
    this.count = hosts.length;
  }

  /** Crossfaded with the local grid: from outside the Galaxy the rings are noise. */
  setStrength(strength: number): void {
    const clamped = THREE.MathUtils.clamp(strength, 0, 1);
    this.opacity.value = RING_PEAK_OPACITY * clamped;
    this.object.visible = clamped > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
