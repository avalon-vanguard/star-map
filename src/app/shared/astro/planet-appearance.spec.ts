import { describe, expect, it } from 'vitest';

import {
  bulkDensityGramsPerCm3,
  classifyPlanet,
  EARTH_DENSITY_G_PER_CM3,
  equilibriumTemperatureK,
  paletteFor,
  planetAppearance,
  PLANET_CLASS_LABELS,
  PlanetClass,
  polarCapExtentDeg,
  seedFromId
} from './planet-appearance';

const EARTH_RADII = { mercury: 0.383, venus: 0.949, earth: 1, mars: 0.532, jupiter: 10.97, saturn: 9.14, uranus: 3.98, neptune: 3.86, europa: 0.245, phobos: 0.0017 };

describe('bulkDensityGramsPerCm3', () => {
  it('gives Earth its own density, by construction', () => {
    expect(bulkDensityGramsPerCm3(1, 1)).toBeCloseTo(EARTH_DENSITY_G_PER_CM3, 9);
  });

  it('separates a ball of iron from a ball of hydrogen, which is what it is for', () => {
    // Mercury is 5.4 g/cm3 and mostly core; Saturn is 0.69 and would float.
    expect(bulkDensityGramsPerCm3(0.055, EARTH_RADII.mercury)).toBeCloseTo(5.4, 0);
    expect(bulkDensityGramsPerCm3(95.2, EARTH_RADII.saturn)).toBeCloseTo(0.69, 1);
  });

  it('has no answer without both numbers', () => {
    expect(bulkDensityGramsPerCm3(undefined, 1)).toBeNull();
    expect(bulkDensityGramsPerCm3(1, undefined)).toBeNull();
    expect(bulkDensityGramsPerCm3(0, 1)).toBeNull();
    expect(bulkDensityGramsPerCm3(1, -1)).toBeNull();
  });
});

describe('equilibriumTemperatureK', () => {
  // The published equilibrium temperatures, which this must reproduce to be worth anything.
  it.each([
    ['Earth', 1, 1, 255],
    ['Mars', 1, 1.524, 206],
    ['Jupiter', 1, 5.204, 112],
    ['Neptune', 1, 30.07, 46]
  ])('reproduces the published equilibrium temperature of %s', (_name, luminosity, semiMajorAxisAu, expected) => {
    expect(equilibriumTemperatureK(luminosity, semiMajorAxisAu)).toBeCloseTo(expected, -0.5);
  });

  it('follows the inverse square root of distance', () => {
    const near = equilibriumTemperatureK(1, 1)!;
    const far = equilibriumTemperatureK(1, 4)!;
    expect(near / far).toBeCloseTo(2, 6);
  });

  it('follows the fourth root of luminosity, which is why a rough luminosity still serves', () => {
    const dim = equilibriumTemperatureK(1, 1)!;
    const bright = equilibriumTemperatureK(16, 1)!;
    expect(bright / dim).toBeCloseTo(2, 6);
  });

  it('puts a hot Jupiter where a hot Jupiter is', () => {
    // 51 Pegasi b: 0.052 AU from a slightly super-solar star, published near 1200 K.
    expect(equilibriumTemperatureK(1.3, 0.052)!).toBeGreaterThan(1000);
  });

  it('cools a world as its albedo rises, as a fourth root', () => {
    expect(equilibriumTemperatureK(1, 1, 0.8)!).toBeLessThan(equilibriumTemperatureK(1, 1, 0)!);
  });

  it('has no answer without a star or an orbit', () => {
    expect(equilibriumTemperatureK(null, 1)).toBeNull();
    expect(equilibriumTemperatureK(1, undefined)).toBeNull();
    expect(equilibriumTemperatureK(0, 1)).toBeNull();
  });
});

describe('classifyPlanet', () => {
  /** Every solar-system body this app carries, at its real size and equilibrium temperature. */
  it.each<[string, { radiusEarth?: number; massEarth?: number; equilibriumTemperatureK?: number }, PlanetClass]>([
    ['Mercury', { radiusEarth: EARTH_RADII.mercury, massEarth: 0.055, equilibriumTemperatureK: 410 }, 'scorched'],
    ['Earth', { radiusEarth: 1, massEarth: 1, equilibriumTemperatureK: 255 }, 'temperate'],
    ['Mars', { radiusEarth: EARTH_RADII.mars, massEarth: 0.107, equilibriumTemperatureK: 206 }, 'temperate'],
    ['Jupiter', { radiusEarth: EARTH_RADII.jupiter, massEarth: 317.8, equilibriumTemperatureK: 112 }, 'gasGiant'],
    ['Saturn', { radiusEarth: EARTH_RADII.saturn, massEarth: 95.2, equilibriumTemperatureK: 82 }, 'gasGiant'],
    ['Uranus', { radiusEarth: EARTH_RADII.uranus, massEarth: 14.5, equilibriumTemperatureK: 58 }, 'iceGiant'],
    ['Neptune', { radiusEarth: EARTH_RADII.neptune, massEarth: 17.1, equilibriumTemperatureK: 46 }, 'iceGiant'],
    ['Europa', { radiusEarth: EARTH_RADII.europa, equilibriumTemperatureK: 112 }, 'icy'],
    ['51 Peg b', { massEarth: 193.9, equilibriumTemperatureK: 1227 }, 'hotGasGiant'],
    ['GJ 1214 b', { radiusEarth: 2.733, massEarth: 8.4, equilibriumTemperatureK: 596 }, 'subNeptune']
  ])('puts %s in the right class', (_name, measurements, expected) => {
    expect(classifyPlanet(measurements)).toBe(expected);
  });

  it('tells a gas giant from an ice giant by size, since temperature cannot', () => {
    // Jupiter is 110 K and Neptune is 47 K: both freezing, and the difference between them is
    // how much hydrogen they hold, not how cold they are.
    const cold = { equilibriumTemperatureK: 100 };
    expect(classifyPlanet({ ...cold, radiusEarth: EARTH_RADII.jupiter })).toBe('gasGiant');
    expect(classifyPlanet({ ...cold, radiusEarth: EARTH_RADII.neptune })).toBe('iceGiant');
  });

  it('calls any giant hot once it is hot, whichever kind it was', () => {
    for (const radiusEarth of [EARTH_RADII.jupiter, EARTH_RADII.neptune]) {
      expect(classifyPlanet({ radiusEarth, equilibriumTemperatureK: 1400 })).toBe('hotGasGiant');
    }
  });

  it('lets density override temperature at both extremes', () => {
    // Iron whatever the weather...
    expect(classifyPlanet({ radiusEarth: 1, massEarth: 1.6, equilibriumTemperatureK: 255 })).toBe('iron');
    // ...and too light to be rock means ice, even where rock would be solid.
    expect(classifyPlanet({ radiusEarth: 1.5, massEarth: 1, equilibriumTemperatureK: 250 })).toBe('icy');
  });

  it('melts a rocky world that is hot enough', () => {
    expect(classifyPlanet({ radiusEarth: 1, equilibriumTemperatureK: 1500 })).toBe('lava');
  });

  it('refuses to call a 11 km moon temperate on the strength of its orbital distance', () => {
    // Phobos sits at Mars's distance and so at Mars's temperature, and is an airless rock.
    expect(classifyPlanet({ radiusEarth: EARTH_RADII.phobos, equilibriumTemperatureK: 206 })).toBe('rocky');
  });

  it('falls back to size alone when the host star is unknown', () => {
    expect(classifyPlanet({ radiusEarth: 1 })).toBe('rocky');
    expect(classifyPlanet({ radiusEarth: EARTH_RADII.jupiter })).toBe('gasGiant');
    expect(classifyPlanet({ radiusEarth: 2.5 })).toBe('subNeptune');
  });

  it('classifies from a mass alone, for the planets only radial velocity has seen', () => {
    expect(classifyPlanet({ massEarth: 300 })).toBe('gasGiant');
    expect(classifyPlanet({ massEarth: 15 })).toBe('iceGiant');
    expect(classifyPlanet({ massEarth: 4 })).toBe('subNeptune');
    expect(classifyPlanet({ massEarth: 1 })).toBe('rocky');
  });

  it('prefers radius over mass, since radius is what the classes are defined by', () => {
    // A puffy planet as massive as Neptune but the size of Jupiter is a gas giant.
    expect(classifyPlanet({ radiusEarth: EARTH_RADII.jupiter, massEarth: 15 })).toBe('gasGiant');
  });

  it('always returns a class, whatever it is given', () => {
    expect(classifyPlanet({})).toBe('rocky');
  });
});

describe('polarCapExtentDeg', () => {
  it('grows caps as a world cools, which is the visible consequence of the derived temperature', () => {
    const warm = polarCapExtentDeg('temperate', 280)!;
    const cool = polarCapExtentDeg('temperate', 230)!;
    const cold = polarCapExtentDeg('temperate', 190)!;
    expect(warm).toBeLessThan(cool);
    expect(cool).toBeLessThan(cold);
  });

  it('covers a frozen world entirely and leaves a warm one bare', () => {
    expect(polarCapExtentDeg('icy', 100)).toBe(90);
    expect(polarCapExtentDeg('rocky', 400)).toBeNull();
  });

  it('gives Earth a cap that stops well short of the tropics', () => {
    const earth = polarCapExtentDeg('temperate', 255)!;
    expect(earth).toBeGreaterThan(5);
    expect(earth).toBeLessThan(45);
  });

  it('does not put ice on a world where ice is not the question', () => {
    for (const planetClass of ['gasGiant', 'hotGasGiant', 'iceGiant', 'subNeptune', 'lava'] as PlanetClass[]) {
      expect(polarCapExtentDeg(planetClass, 100)).toBeNull();
    }
  });

  it('has no answer without a temperature', () => {
    expect(polarCapExtentDeg('temperate', null)).toBeNull();
    expect(polarCapExtentDeg('temperate', undefined)).toBeNull();
  });
});

describe('paletteFor', () => {
  const ALL_CLASSES = Object.keys(PLANET_CLASS_LABELS) as PlanetClass[];

  it('has a palette and a label for every class', () => {
    for (const planetClass of ALL_CLASSES) {
      expect(paletteFor(planetClass)).toBeDefined();
      expect(PLANET_CLASS_LABELS[planetClass].length).toBeGreaterThan(0);
    }
  });

  it('keeps every channel inside the displayable range', () => {
    for (const planetClass of ALL_CLASSES) {
      const palette = paletteFor(planetClass);
      for (const tone of [palette.low, palette.mid, palette.high, palette.cap]) {
        for (const channel of tone) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
      expect(palette.contrast).toBeGreaterThan(0);
      expect(palette.contrast).toBeLessThanOrEqual(1);
    }
  });

  it('bands the worlds with a fluid envelope and gives terrain to the ones with a surface', () => {
    for (const planetClass of ['gasGiant', 'hotGasGiant', 'iceGiant', 'subNeptune'] as PlanetClass[]) {
      expect(paletteFor(planetClass).structure).toBe('banded');
    }
    for (const planetClass of ['lava', 'scorched', 'iron', 'rocky', 'temperate', 'icy'] as PlanetClass[]) {
      expect(paletteFor(planetClass).structure).toBe('terrain');
    }
  });

  it('makes an ice giant blue and a hot giant red, following what each is made of', () => {
    // Methane absorbs red light, which is exactly why Uranus and Neptune look the way they do.
    const iceGiant = paletteFor('iceGiant').mid;
    expect(iceGiant[2]).toBeGreaterThan(iceGiant[0]);
    const hot = paletteFor('hotGasGiant').mid;
    expect(hot[0]).toBeGreaterThan(hot[2]);
  });
});

describe('seedFromId', () => {
  it('is stable, so a world looks the same on every visit', () => {
    expect(seedFromId('Kepler-186 f')).toBe(seedFromId('Kepler-186 f'));
  });

  it('separates bodies that differ only slightly in name', () => {
    expect(seedFromId('TRAPPIST-1 e')).not.toBe(seedFromId('TRAPPIST-1 f'));
  });

  it('stays a non-negative 32-bit integer', () => {
    for (const id of ['', 'a', 'Kepler-186 f', 'HD 209458 b']) {
      const seed = seedFromId(id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });
});

describe('planetAppearance', () => {
  it('derives the whole chain from published measurements', () => {
    const earth = planetAppearance({ id: 'earth', radiusEarth: 1, massEarth: 1, semiMajorAxisAu: 1, hostLuminositySolar: 1 });

    expect(earth.planetClass).toBe('temperate');
    expect(earth.equilibriumTemperatureK).toBeCloseTo(255, -0.5);
    expect(earth.bulkDensityGramsPerCm3).toBeCloseTo(EARTH_DENSITY_G_PER_CM3, 6);
    expect(earth.polarCapExtentDeg).toBeGreaterThan(0);
    expect(earth.palette.structure).toBe('terrain');
  });

  it('reports what it could not derive as null rather than guessing it', () => {
    const unknown = planetAppearance({ id: 'x', radiusEarth: 1 });
    expect(unknown.equilibriumTemperatureK).toBeNull();
    expect(unknown.bulkDensityGramsPerCm3).toBeNull();
    expect(unknown.polarCapExtentDeg).toBeNull();
    expect(unknown.planetClass).toBe('rocky');
  });
});
