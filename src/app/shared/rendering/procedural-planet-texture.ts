import * as THREE from 'three/webgpu';

import { PlanetAppearance, Rgb } from '../astro/planet-appearance';

/**
 * Paints an equirectangular surface for a world from its derived appearance.
 *
 * Two things shape it, and both come out of the physics rather than out of taste. A body with a
 * fluid envelope and no surface gets zonal *bands*, because a rapidly rotating atmosphere
 * organises into them — that is why Jupiter looks the way it does. A body with a solid surface
 * gets *terrain*, fractal highlands and basins, because that is what an impacted, eroded crust
 * looks like at planetary scale. The polar caps then grow and shrink with the derived
 * equilibrium temperature.
 *
 * Written against a plain `Uint8Array` rather than a canvas, which makes it a pure function:
 * fully testable with no DOM, no 2D context to be unavailable, and no per-pixel draw calls.
 */

/** Size for the body-detail view, where the surface fills the screen. */
export const DETAIL_TEXTURE_WIDTH = 512;
export const DETAIL_TEXTURE_HEIGHT = 256;
/**
 * Size for a system-view marker, which is a few pixels across. Deliberately tiny: a system can
 * hold twenty bodies and they are all generated at once as the camera arrives, so this is the
 * size at which that whole set costs less than a frame.
 */
export const MARKER_TEXTURE_WIDTH = 32;
export const MARKER_TEXTURE_HEIGHT = 16;

const TERRAIN_OCTAVES = 4;
const ROUGHNESS_OCTAVES = 3;
const BAND_TURBULENCE_OCTAVES = 3;
/** Zonal bands per hemisphere, varied a little per body so no two giants are identical. */
const MIN_BANDS = 7;
const MAX_BANDS = 14;

/** Hash of three lattice coordinates and a seed to a value in [0, 1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hermite fade, so the interpolated field has no visible lattice creases. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise sampled in three dimensions.
 *
 * Three rather than two on purpose: the texture is equirectangular, so 2D noise would have to
 * be made to wrap by hand at the seam and would still pinch at the poles. Sampling a solid
 * field along the sphere's own surface has neither problem — the field is continuous
 * everywhere the sphere is.
 */
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);

  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);

  const x00 = c000 + (c100 - c000) * xf;
  const x10 = c010 + (c110 - c010) * xf;
  const x01 = c001 + (c101 - c001) * xf;
  const x11 = c011 + (c111 - c011) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;

  return y0 + (y1 - y0) * zf;
}

/** Fractal Brownian motion: octaves of value noise at doubling frequency, halving amplitude. */
function fbm(x: number, y: number, z: number, seed: number, octaves: number): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let total = 0;

  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 7919);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return sum / total;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function mix(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Three-stop ramp across the palette's low, mid and high tones. */
function ramp(appearance: PlanetAppearance, t: number): [number, number, number] {
  const { low, mid, high } = appearance.palette;
  const clamped = clamp01(t);
  return clamped < 0.5 ? mix(low, mid, clamped * 2) : mix(mid, high, (clamped - 0.5) * 2);
}

/** Pulls a value toward or away from the midpoint, by the palette's contrast. */
function applyContrast(value: number, contrast: number): number {
  return clamp01(0.5 + (value - 0.5) * (0.4 + contrast * 1.2));
}

export interface PlanetTextureSize {
  width: number;
  height: number;
}

/**
 * Renders the surface into an RGBA byte array, row-major from the north pole down, ready to
 * hand to a `DataTexture`.
 */
export function renderPlanetTexture(appearance: PlanetAppearance, size: PlanetTextureSize): Uint8Array {
  const { width, height } = size;
  const pixels = new Uint8Array(width * height * 4);
  const { palette, seed } = appearance;
  const banded = palette.structure === 'banded';
  // Band count is stable per body but not identical between bodies, so a system of giants does
  // not read as the same planet drawn several times.
  const bandCount = MIN_BANDS + (seed % (MAX_BANDS - MIN_BANDS + 1));
  const capExtent = appearance.polarCapExtentDeg;

  for (let row = 0; row < height; row++) {
    // Texel centres, so the poles are sampled just inside the surface rather than exactly on it.
    const v = (row + 0.5) / height;
    const latitude = (0.5 - v) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    const sinLatitude = Math.sin(latitude);

    for (let column = 0; column < width; column++) {
      const u = (column + 0.5) / width;
      const longitude = u * Math.PI * 2;
      // The point on the unit sphere this texel maps to — the noise is sampled there.
      const px = cosLatitude * Math.cos(longitude);
      const py = sinLatitude;
      const pz = cosLatitude * Math.sin(longitude);

      let tone: number;
      if (banded) {
        // Latitude, pushed around by turbulence, then folded into zonal bands. The turbulence is
        // what makes a belt wander and braid rather than sit as a perfect stripe.
        const turbulence = fbm(px * 2.2, py * 2.2, pz * 2.2, seed, BAND_TURBULENCE_OCTAVES) - 0.5;
        // Stretched along longitude and squeezed in latitude, which is what shear does to a
        // cloud: the streaks run round the planet rather than across it.
        const fine = fbm(px * 6, py * 30, pz * 6, seed + 101, 3) - 0.5;
        const warped = latitude + turbulence * 0.32 + fine * 0.05;
        tone = 0.5 + 0.5 * Math.sin(warped * bandCount);
        tone = tone * 0.85 + (fine + 0.5) * 0.15;
      } else {
        // Broad landmasses, then finer detail on top of them. The ridged term is the same noise
        // folded about its midpoint, which turns smooth hills into creases — the difference
        // between a surface that reads as cloud and one that reads as ground.
        const continents = fbm(px * 2.4, py * 2.4, pz * 2.4, seed, TERRAIN_OCTAVES);
        const roughness = fbm(px * 18, py * 18, pz * 18, seed + 313, ROUGHNESS_OCTAVES);
        const ridged = 1 - Math.abs(2 * roughness - 1);
        tone = continents * 0.68 + roughness * 0.18 + ridged * 0.14;
      }

      let [r, g, b] = ramp(appearance, applyContrast(tone, palette.contrast));

      if (capExtent !== null && capExtent > 0) {
        // Caps are ragged rather than a clean circle: the same surface noise that shapes the
        // terrain decides how far the ice reaches at each longitude.
        const latitudeFromPoleDeg = 90 - (Math.abs(latitude) * 180) / Math.PI;
        const edge = capExtent * (0.85 + 0.3 * fbm(px * 6, py * 6, pz * 6, seed + 977, 3));
        const coverage = clamp01((edge - latitudeFromPoleDeg) / Math.max(edge * 0.35, 1));
        if (coverage > 0) {
          [r, g, b] = mix([r, g, b], palette.cap, coverage);
        }
      }

      const offset = (row * width + column) * 4;
      pixels[offset] = Math.round(clamp01(r) * 255);
      pixels[offset + 1] = Math.round(clamp01(g) * 255);
      pixels[offset + 2] = Math.round(clamp01(b) * 255);
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
}

const textureCache = new Map<string, THREE.DataTexture>();

/**
 * The rendered surface as a Three.js texture, cached per body and size.
 *
 * A `DataTexture` rather than a `CanvasTexture`: the pixels are computed rather than drawn, so
 * there is no reason to route them through a 2D context that may not exist — which also means
 * this works under a headless test environment where canvas rendering does not.
 */
export function planetTexture(appearance: PlanetAppearance, size: PlanetTextureSize = { width: DETAIL_TEXTURE_WIDTH, height: DETAIL_TEXTURE_HEIGHT }): THREE.DataTexture {
  const key = `${appearance.seed}:${appearance.planetClass}:${appearance.polarCapExtentDeg ?? 'none'}:${size.width}x${size.height}`;
  const cached = textureCache.get(key);
  if (cached) {
    return cached;
  }

  const texture = new THREE.DataTexture(renderPlanetTexture(appearance, size), size.width, size.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Wraps in longitude — the noise is continuous across the seam — but is clamped in latitude,
  // where there is nothing beyond the pole to wrap to.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  textureCache.set(key, texture);
  return texture;
}

/** Average colour of a rendered surface, for anything too small to show the texture itself. */
export function averageColor(pixels: Uint8Array): THREE.Color {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = pixels.length / 4;

  for (let index = 0; index < pixels.length; index += 4) {
    r += pixels[index];
    g += pixels[index + 1];
    b += pixels[index + 2];
  }

  return new THREE.Color(r / count / 255, g / count / 255, b / count / 255);
}
