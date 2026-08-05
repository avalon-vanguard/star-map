import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, smoothstep, uniform, uv, vec2 } from 'three/tsl';

import { GALACTIC_LANDMARKS, landmarkPositionPc } from '../../shared/astro/galaxy';
import { LabeledPoint } from './star-label-overlay';
import { generateMilkyWayParticles, GalaxyParticleCounts } from './milky-way-model';

/**
 * Camera distances (parsecs from the Sun) between which the Galaxy model fades in. Below the
 * near figure the view is the real, measured star field and the model is entirely hidden; above
 * the far figure the model is at full strength and the 50 pc catalogue bubble is a single point.
 */
export const GALAXY_FADE_NEAR_PC = 400;
export const GALAXY_FADE_FAR_PC = 2500;

/** A unit quad centred on the origin — the billboard every particle is drawn on. */
function createQuadGeometry(instanceCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = instanceCount;
  return geometry;
}

/**
 * Draws the Milky Way itself: the bar and bulge, five spiral arms, the smooth disc between them
 * and a thin halo, as one instanced cloud of soft camera-facing billboards.
 *
 * The particles are **illustrative**. Their skeleton is not — arm radii, pitch angles, the
 * Sun's galactocentric distance and the tilt of the disc against the sky are all measured
 * quantities, and the model is built from them in `galaxy.ts`. What no catalogue can supply is
 * the position of each star in the disc, because dust hides most of it from us, so the cloud
 * around that skeleton is scattered rather than observed. The UI says so on the galactic level.
 *
 * Sizes are world-space here, unlike the star field's angular ones: these particles stand for
 * clouds hundreds of parsecs across, so they should grow as the camera closes on them.
 */
export class MilkyWayRenderer {
  readonly object: THREE.Mesh;
  /** How many instances the model actually placed, after rejected samples. */
  readonly particleCount: number;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly fade = uniform(0);
  private fadeValue = 0;

  constructor(seed?: number, counts?: GalaxyParticleCounts) {
    const particles = generateMilkyWayParticles(seed, counts);
    this.particleCount = particles.count;
    this.geometry = createQuadGeometry(particles.count);

    const positionAttribute = new THREE.InstancedBufferAttribute(particles.positions, 3);
    const colorAttribute = new THREE.InstancedBufferAttribute(particles.colors, 3);
    const sizeAttribute = new THREE.InstancedBufferAttribute(particles.sizes, 1);
    const alphaAttribute = new THREE.InstancedBufferAttribute(particles.alphas, 1);

    this.material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
    this.material.positionNode = instancedBufferAttribute(positionAttribute, 'vec3');
    this.material.scaleNode = instancedBufferAttribute(sizeAttribute, 'float');
    this.material.colorNode = instancedBufferAttribute(colorAttribute, 'vec3');
    // A gentler falloff than the star field's: these are clouds, and the tight curve that makes
    // a star read as a bright point makes a cloud read as a solid ball.
    const radius = uv().sub(vec2(0.5)).length();
    const falloff = smoothstep(0.0, 0.5, radius).oneMinus().pow(1.6);
    this.material.opacityNode = falloff.mul(instancedBufferAttribute(alphaAttribute, 'float')).mul(this.fade);

    this.object = new THREE.Mesh(this.geometry, this.material);
    // The quad's own bounds sit at the origin and say nothing about where the instances are.
    this.object.frustumCulled = false;
    this.object.visible = false;
    // Behind everything else: the model is a backdrop for the real data, never in front of it.
    this.object.renderOrder = -1;
  }

  /**
   * Crossfades the model against how far the camera has pulled back, and returns the resulting
   * strength (0-1). The mesh is skipped outright at zero so the local view pays nothing for it.
   */
  setViewerDistancePc(distancePc: number): number {
    const t = (distancePc - GALAXY_FADE_NEAR_PC) / (GALAXY_FADE_FAR_PC - GALAXY_FADE_NEAR_PC);
    this.fadeValue = Math.max(0, Math.min(1, t));
    this.fade.value = this.fadeValue;
    this.object.visible = this.fadeValue > 0;
    return this.fadeValue;
  }

  get strength(): number {
    return this.fadeValue;
  }

  /** Named structural landmarks — the centre, the Sun, and one label per arm. */
  labelPoints(): readonly LabeledPoint[] {
    return GALACTIC_LANDMARKS.map((landmark) => {
      const position = landmarkPositionPc(landmark);
      return { id: `galactic:${landmark.id}`, name: landmark.name, kind: landmark.kind, x: position.x, y: position.y, z: position.z };
    });
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
