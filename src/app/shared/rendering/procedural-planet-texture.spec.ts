import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { PlanetAppearance, PlanetClass, paletteFor, planetAppearance } from '../astro/planet-appearance';
import { averageColor, planetTexture, renderPlanetTexture } from './procedural-planet-texture';

const SIZE = { width: 64, height: 32 };
const ALL_CLASSES: PlanetClass[] = ['lava', 'scorched', 'iron', 'rocky', 'temperate', 'icy', 'subNeptune', 'iceGiant', 'gasGiant', 'hotGasGiant'];

function appearanceOf(planetClass: PlanetClass, overrides: Partial<PlanetAppearance> = {}): PlanetAppearance {
  return {
    planetClass,
    palette: paletteFor(planetClass),
    equilibriumTemperatureK: 250,
    bulkDensityGramsPerCm3: 5,
    polarCapExtentDeg: null,
    seed: 12345,
    ...overrides
  };
}

/** RGB of one texel, 0-255. */
function texelAt(pixels: Uint8Array, width: number, column: number, row: number): [number, number, number] {
  const offset = (row * width + column) * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
}

function difference(a: readonly number[], b: readonly number[]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

describe('renderPlanetTexture', () => {
  it('fills an opaque RGBA buffer of the requested size', () => {
    const pixels = renderPlanetTexture(appearanceOf('rocky'), SIZE);

    expect(pixels).toHaveLength(SIZE.width * SIZE.height * 4);
    for (let index = 3; index < pixels.length; index += 4) {
      expect(pixels[index]).toBe(255);
    }
  });

  it('is the same surface every time, so a world does not change between visits', () => {
    const first = renderPlanetTexture(appearanceOf('gasGiant'), SIZE);
    const second = renderPlanetTexture(appearanceOf('gasGiant'), SIZE);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('gives two different worlds two different surfaces', () => {
    const a = renderPlanetTexture(appearanceOf('rocky', { seed: 1 }), SIZE);
    const b = renderPlanetTexture(appearanceOf('rocky', { seed: 2 }), SIZE);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('wraps continuously around the seam, since the noise is sampled on the sphere', () => {
    // The reason for sampling a solid field along the sphere rather than a plane: 2D noise would
    // have to be stitched at this seam by hand, and would still pinch at the poles.
    const pixels = renderPlanetTexture(appearanceOf('rocky'), { width: 256, height: 128 });
    for (const row of [10, 64, 120]) {
      const left = texelAt(pixels, 256, 0, row);
      const right = texelAt(pixels, 256, 255, row);
      const neighbouring = texelAt(pixels, 256, 1, row);
      // The two edge columns are neighbours on the sphere, so they must differ no more than any
      // other adjacent pair does.
      expect(difference(left, right)).toBeLessThanOrEqual(difference(left, neighbouring) + 12);
    }
  });

  it('varies with latitude, which is what makes a banded world banded', () => {
    const pixels = renderPlanetTexture(appearanceOf('gasGiant'), { width: 128, height: 64 });
    const column = 40;
    let maximumStep = 0;
    for (let row = 1; row < 64; row++) {
      maximumStep = Math.max(maximumStep, difference(texelAt(pixels, 128, column, row), texelAt(pixels, 128, column, row - 1)));
    }
    expect(maximumStep).toBeGreaterThan(0);
  });

  it('paints a polar cap when the derived temperature calls for one, and not otherwise', () => {
    const withCap = renderPlanetTexture(appearanceOf('temperate', { polarCapExtentDeg: 40 }), SIZE);
    const without = renderPlanetTexture(appearanceOf('temperate', { polarCapExtentDeg: null }), SIZE);

    const pole = 0;
    const equator = SIZE.height / 2;
    // At the pole the capped world is markedly brighter; at the equator the two agree.
    const capPole = texelAt(withCap, SIZE.width, 10, pole);
    const barePole = texelAt(without, SIZE.width, 10, pole);
    expect(capPole[0] + capPole[1] + capPole[2]).toBeGreaterThan(barePole[0] + barePole[1] + barePole[2] + 60);
    expect(difference(texelAt(withCap, SIZE.width, 10, equator), texelAt(without, SIZE.width, 10, equator))).toBe(0);
  });

  it('grows the cap further toward the equator as the world gets colder', () => {
    const brightnessAt = (extent: number, row: number): number => {
      const pixels = renderPlanetTexture(appearanceOf('temperate', { polarCapExtentDeg: extent }), SIZE);
      const [r, g, b] = texelAt(pixels, SIZE.width, 20, row);
      return r + g + b;
    };
    const midLatitude = 6;
    expect(brightnessAt(80, midLatitude)).toBeGreaterThan(brightnessAt(20, midLatitude));
  });

  it('draws a banded world and a terrain world differently from the same seed', () => {
    const banded = renderPlanetTexture(appearanceOf('gasGiant'), SIZE);
    const terrain = renderPlanetTexture(appearanceOf('rocky'), SIZE);
    expect(Array.from(banded)).not.toEqual(Array.from(terrain));
  });

  it('keeps a hot giant red and an ice giant blue, end to end', () => {
    const hot = averageColor(renderPlanetTexture(appearanceOf('hotGasGiant'), SIZE));
    const ice = averageColor(renderPlanetTexture(appearanceOf('iceGiant'), SIZE));

    expect(hot.r).toBeGreaterThan(hot.b);
    expect(ice.b).toBeGreaterThan(ice.r);
  });

  it('produces no NaN or out-of-range bytes for any class', () => {
    for (const planetClass of ALL_CLASSES) {
      const pixels = renderPlanetTexture(appearanceOf(planetClass, { polarCapExtentDeg: 30 }), SIZE);
      for (const value of pixels) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('planetTexture', () => {
  it('builds a data texture at the requested size, with no canvas involved', () => {
    // A DataTexture rather than a CanvasTexture: the pixels are computed, not drawn, so this
    // works in an environment with no 2D context at all — which is this one.
    const texture = planetTexture(planetAppearance({ id: 'earth', radiusEarth: 1, massEarth: 1, semiMajorAxisAu: 1, hostLuminositySolar: 1 }), SIZE);

    expect(texture.image.width).toBe(SIZE.width);
    expect(texture.image.height).toBe(SIZE.height);
    expect(texture.image.data).toHaveLength(SIZE.width * SIZE.height * 4);
  });

  it('caches per body and size, so a system of planets is not re-rendered every frame', () => {
    const appearance = planetAppearance({ id: 'mars', radiusEarth: 0.53, semiMajorAxisAu: 1.52, hostLuminositySolar: 1 });
    expect(planetTexture(appearance, SIZE)).toBe(planetTexture(appearance, SIZE));
    expect(planetTexture(appearance, SIZE)).not.toBe(planetTexture(appearance, { width: 32, height: 16 }));
  });

  it('wraps in longitude and clamps in latitude, matching what the sphere actually does', () => {
    const texture = planetTexture(appearanceOf('icy'), SIZE);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });
});

describe('averageColor', () => {
  it('averages a uniform buffer to that colour', () => {
    const pixels = new Uint8Array(16);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels.set([255, 128, 0, 255], index);
    }
    const average = averageColor(pixels);
    expect(average.r).toBeCloseTo(1, 6);
    expect(average.g).toBeCloseTo(128 / 255, 6);
    expect(average.b).toBeCloseTo(0, 6);
  });
});
