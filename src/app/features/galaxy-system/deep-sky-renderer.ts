import * as THREE from 'three/webgpu';

import { DeepSkyKind, DeepSkyRecord } from '../../shared/models/deepsky.model';
import { createGlowTexture } from '../../shared/rendering/skybox';
import { LabeledPoint } from './star-label-overlay';

/**
 * Radius (parsecs) of the shell the backdrop is painted on.
 *
 * Chosen to sit clear of everything else the galaxy camera deals with: well outside the 50 pc
 * star field, beyond the camera's 2000 pc orbit limit so it can never be flown through, and
 * close enough that even the far side of the shell (2000 + 2500 = 4500 pc) stays inside the
 * 5000 pc far plane rather than being clipped away.
 */
export const BACKDROP_RADIUS_PC = 2500;

/**
 * Apparent-size clamps (parsecs at {@link BACKDROP_RADIUS_PC}) for a backdrop sprite. The floor
 * is generous — most catalog objects are a few arcminutes across, and at this shell radius that
 * is a pixel or two — so they read as haze rather than as another star.
 */
const MIN_SPRITE_SIZE_PC = 70;
const MAX_SPRITE_SIZE_PC = 340;

const DEGREES_TO_RADIANS = Math.PI / 180;

/** Loosely evocative of each class's real appearance in long-exposure photography. */
const KIND_COLORS: Readonly<Record<DeepSkyKind, number>> = {
  galaxy: 0xffd9a0,
  nebula: 0xff86b0,
  cluster: 0xa8c8ff
};

/**
 * Opacity bands by apparent magnitude. Sprites share a material per (kind, band), so
 * brightness is quantised rather than continuous — nine materials instead of one per object,
 * which keeps 400-odd backdrop sprites cheap to build and dispose.
 */
const BRIGHTNESS_BANDS: readonly { maxMagnitude: number; opacity: number }[] = [
  { maxMagnitude: 5, opacity: 0.5 },
  { maxMagnitude: 7.5, opacity: 0.3 },
  { maxMagnitude: Infinity, opacity: 0.16 }
];

/**
 * Where a deep-sky object lands on the backdrop shell. The record stores a unit direction,
 * so this is just that direction pushed out to the shell radius.
 */
export function backdropPosition(record: DeepSkyRecord, radiusPc = BACKDROP_RADIUS_PC): THREE.Vector3 {
  return new THREE.Vector3(record.x, record.y, record.z).multiplyScalar(radiusPc);
}

/**
 * On-shell size for an object, from its true angular size — so the backdrop reproduces the
 * real sky, where the Andromeda Galaxy is six times wider than the full Moon.
 *
 * Clamped at both ends: without a floor, the many sub-arcminute objects would be invisible
 * specks, and without a ceiling a handful of very extended objects would blanket the view.
 */
export function backdropSpriteSizePc(record: DeepSkyRecord, radiusPc = BACKDROP_RADIUS_PC): number {
  const trueSize = radiusPc * record.angularSizeDeg * DEGREES_TO_RADIANS;
  return THREE.MathUtils.clamp(trueSize, MIN_SPRITE_SIZE_PC, MAX_SPRITE_SIZE_PC);
}

/** Index into {@link BRIGHTNESS_BANDS}; unphotometered objects fall into the faintest band. */
export function brightnessBandIndex(magnitude: number | null): number {
  if (magnitude === null) {
    return BRIGHTNESS_BANDS.length - 1;
  }
  const index = BRIGHTNESS_BANDS.findIndex((band) => magnitude <= band.maxMagnitude);
  return index === -1 ? BRIGHTNESS_BANDS.length - 1 : index;
}

/**
 * The `limit` most prominent objects, as label anchors on the backdrop shell. Prominence is
 * apparent magnitude, which is the order the ETL already writes, so this is a prefix of the
 * records that actually have a name worth showing.
 */
export function deepSkyLabelPoints(
  records: readonly DeepSkyRecord[],
  limit: number,
  radiusPc = BACKDROP_RADIUS_PC
): LabeledPoint[] {
  return records.slice(0, limit).map((record) => {
    const position = backdropPosition(record, radiusPc);
    return { id: record.id, name: record.name, x: position.x, y: position.y, z: position.z };
  });
}

/**
 * Paints the notable deep-sky objects from `deepsky.json` onto a fixed shell around the star
 * field, as soft additive billboards coloured by kind and sized by real angular extent.
 *
 * Billboards rather than a single `THREE.Points` cloud: the WebGPU backend caps point
 * primitives at one pixel (see `StarFieldRenderer`), which would reduce the Orion Nebula to a
 * dot. Sprites cost one draw call each, so materials are shared across all of them and the
 * catalog is pre-filtered by the ETL to the few hundred objects actually worth drawing.
 */
export class DeepSkyRenderer {
  readonly object = new THREE.Group();

  private readonly materials = new Map<string, THREE.SpriteMaterial>();

  constructor(
    private readonly records: readonly DeepSkyRecord[],
    private readonly radiusPc = BACKDROP_RADIUS_PC
  ) {
    // Drawn before the star field so the stars composite on top of the glow.
    this.object.renderOrder = -1;

    for (const record of records) {
      const sprite = new THREE.Sprite(this.materialFor(record));
      sprite.position.copy(backdropPosition(record, this.radiusPc));
      sprite.scale.setScalar(backdropSpriteSizePc(record, this.radiusPc));
      this.object.add(sprite);
    }
  }

  /** Label anchors for the brightest `limit` objects on this backdrop. */
  labelPoints(limit: number): LabeledPoint[] {
    return deepSkyLabelPoints(this.records, limit, this.radiusPc);
  }

  dispose(): void {
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
    this.object.clear();
  }

  private materialFor(record: DeepSkyRecord): THREE.SpriteMaterial {
    const band = brightnessBandIndex(record.magnitude);
    const key = `${record.kind}:${band}`;

    let material = this.materials.get(key);
    if (!material) {
      const color = KIND_COLORS[record.kind];
      material = new THREE.SpriteMaterial({
        map: createGlowTexture(color, 'diffuse'),
        color,
        transparent: true,
        opacity: BRIGHTNESS_BANDS[band].opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      this.materials.set(key, material);
    }
    return material;
  }
}
