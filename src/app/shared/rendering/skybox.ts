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
 * Falloff shapes for {@link createGlowTexture}.
 *
 * `corona` is a tight, bright core for a star's or planet's halo, where the light really does
 * come from a small hot source. `diffuse` is a much softer, dimmer profile for deep-sky
 * objects, which are extended clouds — the same tight curve turns them into hard-edged
 * billiard balls that read as solid geometry rather than as haze.
 */
export type GlowProfile = 'corona' | 'diffuse';

const GLOW_PROFILES: Readonly<Record<GlowProfile, readonly { offset: number; alpha: number }[]>> = {
  corona: [
    { offset: 0, alpha: 0.85 },
    { offset: 0.4, alpha: 0.35 },
    { offset: 1, alpha: 0 }
  ],
  diffuse: [
    { offset: 0, alpha: 0.5 },
    { offset: 0.18, alpha: 0.34 },
    { offset: 0.45, alpha: 0.13 },
    { offset: 0.75, alpha: 0.03 },
    { offset: 1, alpha: 0 }
  ]
};

/**
 * A soft radial-gradient canvas texture, cached per color and profile, used to fake
 * atmosphere/corona glow and to paint deep-sky objects on the galaxy backdrop. Returns
 * `undefined` if 2D canvas rendering isn't available (e.g. under a test/jsdom environment with
 * no canvas backend) so callers can fall back to a flat-color sprite instead.
 *
 * The cache is process-wide and intentionally not disposed: there is one texture per distinct
 * color/profile pair, they are tiny, and they outlive any individual scene.
 */
export function createGlowTexture(color: THREE.ColorRepresentation, profile: GlowProfile = 'corona'): THREE.Texture | undefined {
  const key = `${new THREE.Color(color).getHexString()}:${profile}`;
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
  for (const stop of GLOW_PROFILES[profile]) {
    gradient.addColorStop(stop.offset, `rgba(${r}, ${g}, ${b}, ${stop.alpha})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  glowSpriteCache.set(key, texture);
  return texture;
}

/**
 * Builds a soft additive-blended glow halo (used for planetary atmospheres and the Sun's
 * corona), `extent` across in world units. Cheap billboard-sprite approximation rather than a
 * view-angle-correct Fresnel shader, chosen to stay within built-in material types the WebGPU
 * backend renders natively (see plan risk on TSL/shader maturity). Falls back to a
 * flat-colored (gradient-less) sprite if canvas rendering is unavailable.
 *
 * Takes the finished extent rather than a radius and a multiplier: how big a star's halo should
 * be is not a fixed multiple of the star, it depends on how the system is framed, and that
 * decision belongs with the framing (see `starGlowExtentAu`).
 */
export function createGlowSprite(color: THREE.ColorRepresentation, extent: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: createGlowTexture(color),
    color: color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(extent);
  return sprite;
}
