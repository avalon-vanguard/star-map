import * as THREE from 'three/webgpu';

/**
 * Applies a real Milky Way panorama (see `texture-catalog.ts`/`README.md`) as the scene's
 * background, mapped equirectangularly so it wraps the camera like a real sky rather than a
 * flat image. Loading is non-blocking: the scene renders immediately with its previous
 * background and swaps in the photo once it decodes.
 */
export function applyMilkyWaySkybox(scene: THREE.Scene, path: string): void {
  new THREE.TextureLoader().load(
    path,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
    },
    undefined,
    (error) => console.error(`Failed to load the skybox texture "${path}".`, error)
  );
}

const glowSpriteCache = new Map<string, THREE.Texture>();

/**
 * A soft radial-gradient canvas texture, cached per color, used to fake atmosphere/corona glow.
 * Returns `undefined` if 2D canvas rendering isn't available (e.g. under a test/jsdom
 * environment with no canvas backend) so callers can fall back to a flat-color sprite instead.
 */
function glowSpriteTexture(color: THREE.ColorRepresentation): THREE.Texture | undefined {
  const key = new THREE.Color(color).getHexString();
  const cached = glowSpriteCache.get(key);
  if (cached) {
    return cached;
  }

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  const rgb = new THREE.Color(color);
  const [r, g, b] = [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255)];

  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.85)`);
  gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.35)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  glowSpriteCache.set(key, texture);
  return texture;
}

/**
 * Builds a soft additive-blended glow halo (used for planetary atmospheres and the Sun's
 * corona) sized relative to the given object radius. Cheap billboard-sprite approximation
 * rather than a view-angle-correct Fresnel shader, chosen to stay within built-in material
 * types the WebGPU backend renders natively (see plan risk on TSL/shader maturity). Falls back
 * to a flat-colored (gradient-less) sprite if canvas rendering is unavailable.
 */
export function createGlowSprite(color: THREE.ColorRepresentation, radius: number, scale: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: glowSpriteTexture(color),
    color: color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(radius * scale);
  return sprite;
}
