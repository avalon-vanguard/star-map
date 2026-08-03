import * as THREE from 'three/webgpu';

/**
 * Real NASA/ESA/USGS photography baked into `src/assets/textures/bodies/` at build time,
 * keyed by the same ids used in `bodies.json`. Bodies without an entry here (most exoplanets,
 * a few moons whose photo wasn't sourced this round, and any future body) fall back to
 * `proceduralBodyTexture()` below rather than a flat color.
 *
 * Provenance (all public domain NASA/JPL or CC BY 4.0 Solar System Scope, via Wikimedia
 * Commons — see each file's Commons page for the original credit line):
 * mercury/venus/earth/mars/saturn/uranus/neptune/moon/sun/saturn-ring/skybox — Solar System
 * Scope texture pack (CC BY 4.0); jupiter — Solar System Scope 8k pack (CC BY 4.0); pluto —
 * NASA/JHUAPL/SwRI New Horizons true-color mosaic; deimos — NASA/JPL/University of Arizona
 * MRO HiRISE; io — NASA/JPL Galileo highest-resolution true-color mosaic; titan — NASA/JPL
 * Cassini true-color view.
 */
const BODY_TEXTURE_PATHS: Record<string, string> = {
  mercury: 'assets/textures/bodies/mercury.jpg',
  venus: 'assets/textures/bodies/venus.jpg',
  earth: 'assets/textures/bodies/earth.jpg',
  mars: 'assets/textures/bodies/mars.jpg',
  jupiter: 'assets/textures/bodies/jupiter.jpg',
  saturn: 'assets/textures/bodies/saturn.jpg',
  uranus: 'assets/textures/bodies/uranus.jpg',
  neptune: 'assets/textures/bodies/neptune.jpg',
  pluto: 'assets/textures/bodies/pluto.jpg',
  moon: 'assets/textures/bodies/moon.jpg',
  deimos: 'assets/textures/bodies/deimos.jpg',
  io: 'assets/textures/bodies/io.jpg',
  titan: 'assets/textures/bodies/titan.jpg'
};

/** The Sun isn't a `BodyRecord` (it's the system's star marker), so it's looked up separately. */
export const SUN_TEXTURE_PATH = 'assets/textures/bodies/sun.jpg';
export const SATURN_RING_TEXTURE_PATH = 'assets/textures/bodies/saturn_ring.png';
export const MILKY_WAY_SKYBOX_PATH = 'assets/textures/skybox/milkyway.jpg';

/** True for the handful of bodies that have real photographic atmospheres worth glowing. */
const ATMOSPHERE_BY_ID: Record<string, THREE.ColorRepresentation> = {
  venus: 0xf3dfa6,
  earth: 0x7fb8ff,
  mars: 0xd9a066,
  jupiter: 0xe8d3ad,
  saturn: 0xe0d2a8,
  uranus: 0x9fe8e8,
  neptune: 0x5b7fff,
  titan: 0xf0b25c
};

export function bodyTexturePath(id: string): string | undefined {
  return BODY_TEXTURE_PATHS[id];
}

export function atmosphereColorFor(id: string): THREE.ColorRepresentation | undefined {
  return ATMOSPHERE_BY_ID[id];
}

const textureLoader = new THREE.TextureLoader();
const loadedTextures = new Map<string, THREE.Texture>();

/**
 * Loads (and caches) a texture by asset path, applying `colorSpace` so JPEG/PNG source
 * photography matches Three.js's expected sRGB working space. Non-blocking: the texture is
 * returned immediately and updates in place once the image data arrives (or errors, which is
 * logged rather than thrown so a slow/unavailable network never breaks the scene).
 */
export function loadCachedTexture(path: string): THREE.Texture {
  const cached = loadedTextures.get(path);
  if (cached) {
    return cached;
  }

  const texture = textureLoader.load(
    path,
    undefined,
    undefined,
    (error) => console.error(`Failed to load texture "${path}".`, error)
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  loadedTextures.set(path, texture);
  return texture;
}

const proceduralTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Generates a simple procedural surface for bodies with no real photograph available — mainly
 * exoplanets, whose actual surfaces have never been directly imaged. This is an honest artistic
 * stand-in (mottled bands tinted by the body's classification color), not a fabricated "real"
 * texture, and is cached per color so repeated exoplanets of the same kind share one canvas.
 * Returns `undefined` if 2D canvas rendering isn't available (e.g. under a test/jsdom
 * environment with no canvas backend); callers should fall back to a flat material color.
 */
export function proceduralBodyTexture(baseColor: THREE.ColorRepresentation): THREE.CanvasTexture | undefined {
  const key = new THREE.Color(baseColor).getHexString();
  const cached = proceduralTextureCache.get(key);
  if (cached) {
    return cached;
  }

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  const base = new THREE.Color(baseColor);
  const light = base.clone().offsetHSL(0, -0.15, 0.14);
  const dark = base.clone().offsetHSL(0, 0.05, -0.16);

  context.fillStyle = `#${base.getHexString()}`;
  context.fillRect(0, 0, size, size);

  // A handful of horizontal-ish noisy bands, reminiscent of banded gas giants / mottled rock,
  // without claiming to depict any specific real surface feature.
  let seed = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const bandCount = 10;
  for (let i = 0; i < bandCount; i++) {
    const y = (i / bandCount) * size + random() * (size / bandCount) * 0.4;
    const height = size / bandCount * (0.5 + random() * 0.6);
    context.fillStyle = `#${(random() > 0.5 ? light : dark).getHexString()}`;
    context.globalAlpha = 0.35 + random() * 0.25;
    context.fillRect(0, y, size, height);
  }
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  proceduralTextureCache.set(key, texture);
  return texture;
}
