import * as THREE from 'three/webgpu';

/**
 * Real NASA/ESA/USGS photography baked into `src/assets/textures/bodies/` at build time,
 * keyed by the same ids used in `bodies.json`.
 *
 * Only surface *maps* belong here: equirectangular images, twice as wide as tall, that wrap a
 * sphere. Everything else — every exoplanet, since not one has ever been imaged, and every moon
 * or dwarf planet with no such map in the repository — falls through to
 * `procedural-planet-texture.ts`, which derives a surface from the body's own measured size,
 * mass, orbit and host star instead.
 *
 * Io, Pluto, Titan and Deimos used to be listed with square photographs of them: pictures of a
 * lit disc against black sky, not maps, which wrapped round a sphere put black sky on a fifth to a
 * third of the surface. Io's, Pluto's and Titan's are now the global mosaics the moons below are
 * drawn from; Deimos's photograph is still in the folder, unlisted, for want of a map whose
 * longitudes could be checked.
 *
 * Provenance (CC BY 4.0 Solar System Scope, via Wikimedia Commons — see each file's Commons page
 * for the original credit line): mercury/venus/earth/mars/saturn/uranus/neptune/moon/sun/
 * saturn-ring/skybox — Solar System Scope texture pack; jupiter — Solar System Scope 8k pack.
 *
 * The moons', Ceres's and Pluto's are public-domain mission mosaics from USGS Astrogeology and the
 * PDS, each put in the same frame — longitude 0 in the middle, east to the right — and each
 * measured, in `assets/textures/README.md`. Where a probe saw only part of a body (Pluto, Charon,
 * Triton, Phoebe, the Galilean poles), the rest is a flat grey, never invented terrain.
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
  moon: 'assets/textures/bodies/moon.jpg',
  phobos: 'assets/textures/bodies/phobos.jpg',
  io: 'assets/textures/bodies/io.jpg',
  europa: 'assets/textures/bodies/europa.jpg',
  ganymede: 'assets/textures/bodies/ganymede.jpg',
  callisto: 'assets/textures/bodies/callisto.jpg',
  mimas: 'assets/textures/bodies/mimas.jpg',
  enceladus: 'assets/textures/bodies/enceladus.jpg',
  tethys: 'assets/textures/bodies/tethys.jpg',
  dione: 'assets/textures/bodies/dione.jpg',
  rhea: 'assets/textures/bodies/rhea.jpg',
  titan: 'assets/textures/bodies/titan.jpg',
  iapetus: 'assets/textures/bodies/iapetus.jpg',
  phoebe: 'assets/textures/bodies/phoebe.jpg',
  triton: 'assets/textures/bodies/triton.jpg',
  ceres: 'assets/textures/bodies/ceres.jpg',
  pluto: 'assets/textures/bodies/pluto.jpg',
  charon: 'assets/textures/bodies/charon.jpg'
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
