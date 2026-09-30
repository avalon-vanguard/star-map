import * as THREE from 'three/webgpu';

/**
 * Real NASA/ESA/USGS photography baked into `src/assets/textures/bodies/` at build time,
 * keyed by the same ids used in `bodies.json`.
 *
 * Only surface *maps* belong here: equirectangular images, twice as wide as tall, that wrap a
 * sphere. Everything else — every exoplanet, since the few imaged were seen only as points of
 * light, and every moon
 * or dwarf planet with no such map in the repository — falls through to
 * `procedural-planet-texture.ts`, which derives a surface from the body's own measured size,
 * mass, orbit and host star instead.
 *
 * Io, Pluto, Titan and Deimos used to be listed with square photographs of them: pictures of a
 * lit disc against black sky, not maps, which wrapped round a sphere put black sky on a fifth to a
 * third of the surface. All four are now global mosaics like the other moons'.
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
  deimos: 'assets/textures/bodies/deimos.jpg',
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

/**
 * The radii, in km from Saturn's centre, that `saturn_ring.png`'s left and right edges stand for.
 *
 * The strip runs straight out from its left edge to its right, and read off its alpha the ring
 * edges fall where one scale puts them: the C ring's inner edge (74 490 km) at 91 of its 1 280 px,
 * the B ring's inner edge (92 000) at 404.5 and outer (117 580) at 860, the A ring's outer edge
 * (136 775) at 1 204 and the F ring (140 180) at 1 267.5 — all within 1.8 px of 55.9 km a pixel.
 * The one miss is the Cassini Division's outer edge (122 170), which the strip draws 30 px (1 700
 * km) too far in. The edges are not the 74 500 and 140 220 km of the C ring and the F ring: sized to
 * those, the B ring's inner edge would sit 3 300 km out.
 */
export const SATURN_RING_INNER_KM = 69_400;
export const SATURN_RING_OUTER_KM = 141_000;

/**
 * Saturn's rings, flat in the equator of a sphere built round +Y — its XZ plane — and sized
 * against the planet as drawn: `drawnRadius` for Saturn's `planetRadiusKm`, so the rings keep their
 * true proportion to the planet wherever it is drawn and however it is scaled.
 *
 * `RingGeometry`'s own UVs wrap round the angle, so u is set to the distance from the centre instead,
 * which is the way the strip runs. Lit, from both faces: the face turned to the Sun is lit by the
 * height of the Sun above the ring plane, and the other falls dark. Nothing in the app casts a
 * shadow, so neither the planet on the rings nor the rings on the planet do.
 */
export function saturnRing(planetRadiusKm: number, drawnRadius: number): THREE.Mesh {
  const unitsPerKm = drawnRadius / planetRadiusKm;
  const inner = SATURN_RING_INNER_KM * unitsPerKm;
  const outer = SATURN_RING_OUTER_KM * unitsPerKm;
  const geometry = new THREE.RingGeometry(inner, outer, 128, 1).rotateX(-Math.PI / 2);
  const position = geometry.attributes['position'];
  const uv = geometry.attributes['uv'];
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    uv.setXY(i, THREE.MathUtils.clamp((vertex.length() - inner) / (outer - inner), 0, 1), 1);
  }
  // The strip's own alpha is the rings' opacity: dense in the B ring, thin in the C ring.
  const material = new THREE.MeshStandardMaterial({
    map: loadCachedTexture(SATURN_RING_TEXTURE_PATH),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 1,
    metalness: 0
  });
  return new THREE.Mesh(geometry, material);
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
