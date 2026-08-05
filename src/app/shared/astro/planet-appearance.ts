/**
 * What a world probably looks like, derived from what has been measured about it.
 *
 * No exoplanet's surface has ever been imaged, and a handful of the solar system's own moons
 * have no usable photograph in this app's asset set either. Rather than paint those bodies a
 * flat colour chosen by category, this module reasons from the numbers that *are* published —
 * radius, mass, orbital distance, and the host star's luminosity — to a temperature, a bulk
 * density, and from those to a class of world with a palette and a surface structure.
 *
 * The chain is: mass and radius give density, which separates rock from ice from gas; the star's
 * luminosity and the orbital distance give an equilibrium temperature, which decides whether
 * that material is molten, solid, or frozen. Both steps are standard, and both are stated on
 * screen — this produces a *derived* appearance, never a claim about an observation.
 */

/** Equilibrium temperature of a body at 1 AU from the Sun with zero albedo, in kelvin. */
export const SOLAR_EQUILIBRIUM_TEMPERATURE_K = 278.6;

/**
 * Default Bond albedo where none is published, which is all of them. The solar system's rocky
 * bodies cluster near this: Earth 0.31, Mars 0.25, Mercury 0.09, the Moon 0.11, and the giants
 * 0.29-0.5. Anything in that range moves the temperature by a few per cent, since it enters as
 * a fourth root.
 */
export const DEFAULT_BOND_ALBEDO = 0.3;

export const EARTH_RADIUS_KM = 6371;
/** Earth's mean bulk density, in g/cm3 — the reference every other world is compared against. */
export const EARTH_DENSITY_G_PER_CM3 = 5.51;

/**
 * Class boundaries in Earth radii.
 *
 * Below the rocky ceiling a world cannot hold onto hydrogen. Above the gas-giant floor it is
 * mostly hydrogen and helium. Between sit the ice giants — Uranus and Neptune are both close to
 * 3.9 Earth radii — and below those the sub-Neptunes, the commonest kind of planet found and the
 * one with no solar-system example at all.
 */
const ROCKY_MAX_RADIUS_EARTH = 1.8;
const ICE_GIANT_MIN_RADIUS_EARTH = 3.5;
const GAS_GIANT_MIN_RADIUS_EARTH = 6;

/**
 * The same ladder in Earth masses, for the ~1400 planets with a published mass and no radius —
 * mostly radial-velocity detections, which measure mass and never see a transit.
 */
const SUB_NEPTUNE_MIN_MASS_EARTH = 2;
const ICE_GIANT_MIN_MASS_EARTH = 8;
const GAS_GIANT_MIN_MASS_EARTH = 50;

/**
 * Temperature boundaries in kelvin.
 *
 * The temperate band is the conservative one: Earth's equilibrium temperature is 255 K and
 * Mars's is 206 K, both well inside it, while Venus's 300 K sits outside — which is the right
 * answer here, since equilibrium temperature deliberately ignores the greenhouse effect that
 * takes Venus's actual surface to 737 K.
 */
const LAVA_MIN_K = 1200;
const SCORCHED_MIN_K = 400;
const TEMPERATE_MIN_K = 175;
const TEMPERATE_MAX_K = 290;
const HOT_GIANT_MIN_K = 900;

/**
 * Smallest world that gets called temperate, in Earth radii — about 1900 km, near the size below
 * which a body cannot hold an atmosphere at all. Without it, Phobos comes out "temperate" on the
 * strength of Mars's orbital distance, which is true of its temperature and absurd of the 11 km
 * airless rock itself.
 */
const TEMPERATE_MIN_RADIUS_EARTH = 0.3;

/** Density boundaries in g/cm3, either side of the rocky band. */
const IRON_MIN_DENSITY = 7.5;
const VOLATILE_MAX_DENSITY = 3;

/**
 * Bulk density in g/cm3 from a mass in Earth masses and a radius in Earth radii.
 *
 * This is the single most informative derived quantity about a planet: it is the difference
 * between a ball of iron, a ball of rock, a ball of water and a ball of hydrogen, and it comes
 * straight out of two published numbers with no modelling in between.
 */
export function bulkDensityGramsPerCm3(massEarth: number | undefined, radiusEarth: number | undefined): number | null {
  if (!massEarth || !radiusEarth || massEarth <= 0 || radiusEarth <= 0) {
    return null;
  }
  return EARTH_DENSITY_G_PER_CM3 * (massEarth / Math.pow(radiusEarth, 3));
}

/**
 * Equilibrium temperature in kelvin: the temperature at which a body re-radiates exactly the
 * starlight it absorbs.
 *
 * `T = 278.6 K * (L/Lsun)^(1/4) * (a/AU)^(-1/2) * (1-A)^(1/4)`, the standard blackbody balance
 * for a rapidly-rotating body. It ignores internal heat and any greenhouse effect, both of which
 * push the real surface warmer — Venus's surface is 737 K against an equilibrium 232 K. It is
 * nonetheless the right quantity here, because it is what decides the *state* of the material a
 * world is made of, which is what its surface looks like.
 */
export function equilibriumTemperatureK(
  luminositySolar: number | null | undefined,
  semiMajorAxisAu: number | undefined,
  bondAlbedo: number = DEFAULT_BOND_ALBEDO
): number | null {
  if (!luminositySolar || !semiMajorAxisAu || luminositySolar <= 0 || semiMajorAxisAu <= 0) {
    return null;
  }
  return SOLAR_EQUILIBRIUM_TEMPERATURE_K * Math.pow(luminositySolar, 0.25) * Math.pow(semiMajorAxisAu, -0.5) * Math.pow(1 - bondAlbedo, 0.25);
}

/**
 * The kinds of world this app distinguishes. Chosen to be the classes that actually look
 * different from each other, and that the available measurements can actually separate.
 */
export type PlanetClass = 'lava' | 'scorched' | 'iron' | 'rocky' | 'temperate' | 'icy' | 'subNeptune' | 'iceGiant' | 'gasGiant' | 'hotGasGiant';

export interface PlanetMeasurements {
  radiusEarth?: number;
  massEarth?: number;
  /** Equilibrium temperature, if it could be derived; `null`/absent when the star is unknown. */
  equilibriumTemperatureK?: number | null;
}

/**
 * Sorts a world into a class from its measurements.
 *
 * Size decides the family and temperature decides the state within it, which is the order the
 * evidence actually supports: a radius separates a gas giant from a rock far more reliably than
 * any temperature can, and temperature then separates a molten rock from a frozen one.
 *
 * With no temperature — the case for a planet whose host star is not in the star catalogue —
 * every world falls back to the temperate-agnostic member of its family rather than being
 * guessed at.
 */
export function classifyPlanet(measurements: PlanetMeasurements): PlanetClass {
  const { radiusEarth, massEarth } = measurements;
  const temperature = measurements.equilibriumTemperatureK ?? null;
  const density = bulkDensityGramsPerCm3(massEarth, radiusEarth);
  const family = sizeFamily(radiusEarth, massEarth);

  if (family === 'gasGiant' || family === 'iceGiant') {
    // Temperature separates a hot giant from a cold one but not a gas giant from an ice giant:
    // Jupiter's equilibrium temperature is 110 K and Neptune's is 47 K, both freezing. What
    // actually distinguishes them is how much hydrogen they hold, which is what size measures.
    return temperature !== null && temperature >= HOT_GIANT_MIN_K ? 'hotGasGiant' : family;
  }
  if (family === 'subNeptune') {
    return 'subNeptune';
  }

  // Below the rocky ceiling. Density, where it is known, overrides temperature at both extremes:
  // an iron-rich world reads metallic whatever its temperature, and one too light to be rock is
  // an ice/water world even if it sits where rock would be solid.
  if (density !== null && density >= IRON_MIN_DENSITY) {
    return 'iron';
  }
  if (temperature !== null && temperature >= LAVA_MIN_K) {
    return 'lava';
  }
  if (density !== null && density <= VOLATILE_MAX_DENSITY && (temperature === null || temperature < TEMPERATE_MAX_K)) {
    return 'icy';
  }
  if (temperature === null) {
    return 'rocky';
  }
  if (temperature >= SCORCHED_MIN_K) {
    return 'scorched';
  }
  if (temperature < TEMPERATE_MIN_K) {
    return 'icy';
  }
  const bigEnoughForAnAtmosphere = radiusEarth === undefined || radiusEarth >= TEMPERATE_MIN_RADIUS_EARTH;
  return temperature <= TEMPERATE_MAX_K && bigEnoughForAnAtmosphere ? 'temperate' : 'rocky';
}

/**
 * Which family a world's bulk puts it in, from a radius where one is published and from a mass
 * where only that is. Radius is preferred: it is what the classes are actually defined by, and
 * mass alone leaves a dense super-Earth and a puffy sub-Neptune indistinguishable.
 */
function sizeFamily(radiusEarth: number | undefined, massEarth: number | undefined): 'rocky' | 'subNeptune' | 'iceGiant' | 'gasGiant' {
  if (radiusEarth !== undefined && radiusEarth > 0) {
    if (radiusEarth >= GAS_GIANT_MIN_RADIUS_EARTH) {
      return 'gasGiant';
    }
    if (radiusEarth >= ICE_GIANT_MIN_RADIUS_EARTH) {
      return 'iceGiant';
    }
    return radiusEarth > ROCKY_MAX_RADIUS_EARTH ? 'subNeptune' : 'rocky';
  }

  const mass = massEarth ?? 0;
  if (mass >= GAS_GIANT_MIN_MASS_EARTH) {
    return 'gasGiant';
  }
  if (mass >= ICE_GIANT_MIN_MASS_EARTH) {
    return 'iceGiant';
  }
  return mass >= SUB_NEPTUNE_MIN_MASS_EARTH ? 'subNeptune' : 'rocky';
}

/** Human-readable name for a class, for the info panel. */
export const PLANET_CLASS_LABELS: Readonly<Record<PlanetClass, string>> = {
  lava: 'Molten rock',
  scorched: 'Scorched rock',
  iron: 'Iron-rich world',
  rocky: 'Rocky world',
  temperate: 'Temperate rock',
  icy: 'Ice world',
  subNeptune: 'Sub-Neptune',
  iceGiant: 'Ice giant',
  gasGiant: 'Gas giant',
  hotGasGiant: 'Hot gas giant'
};

/** An RGB triple in 0-1, the form the texture generator and Three.js both want. */
export type Rgb = readonly [number, number, number];

/**
 * The palette and surface structure each class is drawn with.
 *
 * `low`/`mid`/`high` are the three tones the surface is built from — basin floor, general
 * surface, highland or cloud top — and `cap` is the polar tone. Colours are reasoned from the
 * chemistry each class implies: silicates and basalt are grey-brown, hot silicate cloud decks
 * glow red, ammonia clouds are cream and ochre, and methane absorbs red light, which is exactly
 * why Uranus and Neptune are the colour they are.
 */
export interface PlanetPalette {
  readonly low: Rgb;
  readonly mid: Rgb;
  readonly high: Rgb;
  readonly cap: Rgb;
  /** `banded` for a fluid envelope with zonal flow, `terrain` for a solid surface. */
  readonly structure: 'banded' | 'terrain';
  /** How much the three tones separate, 0-1. Hazy worlds are flat, airless ones are stark. */
  readonly contrast: number;
}

const PALETTES: Readonly<Record<PlanetClass, PlanetPalette>> = {
  // Basalt darkened almost to black, cut by exposed magma. Real molten silicate at 1500 K glows
  // a dull orange-red, not the yellow-white of a much hotter furnace.
  lava: { low: [0.09, 0.06, 0.06], mid: [0.24, 0.13, 0.1], high: [0.95, 0.35, 0.12], cap: [0.32, 0.12, 0.08], structure: 'terrain', contrast: 0.95 },
  // Baked rock with the volatiles long gone: Mercury's colour, which is what is left behind.
  scorched: { low: [0.24, 0.2, 0.18], mid: [0.42, 0.36, 0.31], high: [0.6, 0.53, 0.46], cap: [0.45, 0.4, 0.36], structure: 'terrain', contrast: 0.8 },
  // A world dense enough to be mostly metal reads darker and greyer than silicate rock.
  iron: { low: [0.16, 0.15, 0.16], mid: [0.33, 0.31, 0.32], high: [0.52, 0.5, 0.53], cap: [0.4, 0.39, 0.41], structure: 'terrain', contrast: 0.7 },
  rocky: { low: [0.25, 0.21, 0.18], mid: [0.45, 0.38, 0.31], high: [0.66, 0.58, 0.48], cap: [0.78, 0.78, 0.8], structure: 'terrain', contrast: 0.7 },
  // Where water can be liquid. Deliberately restrained: this is a temperature, not a detection.
  temperate: { low: [0.12, 0.2, 0.32], mid: [0.3, 0.36, 0.36], high: [0.55, 0.52, 0.42], cap: [0.9, 0.93, 0.96], structure: 'terrain', contrast: 0.6 },
  icy: { low: [0.55, 0.62, 0.7], mid: [0.75, 0.81, 0.86], high: [0.92, 0.95, 0.98], cap: [0.97, 0.98, 1.0], structure: 'terrain', contrast: 0.45 },
  // The commonest planet found and the one with no solar-system example. A thick hydrogen haze
  // over an unseen interior, so: banded, but with almost no contrast to band.
  subNeptune: { low: [0.42, 0.47, 0.5], mid: [0.58, 0.63, 0.64], high: [0.72, 0.76, 0.75], cap: [0.62, 0.67, 0.68], structure: 'banded', contrast: 0.22 },
  // Methane absorbs red light; what comes back out is the blue-green of Uranus and Neptune.
  iceGiant: { low: [0.13, 0.32, 0.55], mid: [0.24, 0.5, 0.72], high: [0.55, 0.78, 0.88], cap: [0.35, 0.6, 0.78], structure: 'banded', contrast: 0.45 },
  // Ammonia cloud tops over ochre organics: the Jupiter/Saturn palette.
  gasGiant: { low: [0.45, 0.32, 0.22], mid: [0.72, 0.6, 0.44], high: [0.92, 0.87, 0.76], cap: [0.6, 0.52, 0.42], structure: 'banded', contrast: 0.7 },
  // Too hot for ammonia or water clouds; silicate and alkali-metal cloud decks over a glowing
  // interior, which is why hot Jupiters are modelled as deep red rather than as bright ones.
  hotGasGiant: { low: [0.28, 0.08, 0.07], mid: [0.55, 0.18, 0.12], high: [0.85, 0.42, 0.2], cap: [0.4, 0.14, 0.1], structure: 'banded', contrast: 0.6 }
};

export function paletteFor(planetClass: PlanetClass): PlanetPalette {
  return PALETTES[planetClass];
}

/**
 * Latitude, in degrees from the pole, that polar ice reaches down to — or `null` for a world
 * where ice is not the question.
 *
 * Genuinely physical, and the clearest visible consequence of the derived temperature: caps
 * grow as a world cools. They are absent above the point where water cannot be stable anywhere
 * and cover the whole globe below the point where it cannot melt anywhere.
 */
export function polarCapExtentDeg(planetClass: PlanetClass, temperatureK: number | null | undefined): number | null {
  if (temperatureK === null || temperatureK === undefined) {
    return null;
  }
  if (planetClass !== 'temperate' && planetClass !== 'rocky' && planetClass !== 'icy') {
    return null;
  }
  if (temperatureK >= TEMPERATE_MAX_K) {
    return null;
  }
  if (temperatureK <= TEMPERATE_MIN_K) {
    return 90;
  }
  // Linear between the two: nothing at the warm end, global at the cold end.
  return 90 * ((TEMPERATE_MAX_K - temperatureK) / (TEMPERATE_MAX_K - TEMPERATE_MIN_K));
}

/** Everything the texture generator needs, and everything the info panel reports. */
export interface PlanetAppearance {
  readonly planetClass: PlanetClass;
  readonly palette: PlanetPalette;
  readonly equilibriumTemperatureK: number | null;
  readonly bulkDensityGramsPerCm3: number | null;
  readonly polarCapExtentDeg: number | null;
  /** Stable per body, so a world looks the same on every visit. */
  readonly seed: number;
}

/** Stable 32-bit hash of a body id, so the same world is generated identically every time. */
export function seedFromId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The full derivation, from published measurements to a drawable appearance.
 *
 * `hostLuminositySolar` is the star's total output in solar units — see `stellar.ts`, which
 * derives it from the star catalogue's own magnitude and distance. Without it there is no
 * temperature, and the classification falls back to what size and density alone can say.
 */
export function planetAppearance(input: {
  id: string;
  radiusEarth?: number;
  massEarth?: number;
  semiMajorAxisAu?: number;
  hostLuminositySolar?: number | null;
}): PlanetAppearance {
  const temperature = equilibriumTemperatureK(input.hostLuminositySolar, input.semiMajorAxisAu);
  const planetClass = classifyPlanet({ radiusEarth: input.radiusEarth, massEarth: input.massEarth, equilibriumTemperatureK: temperature });

  return {
    planetClass,
    palette: paletteFor(planetClass),
    equilibriumTemperatureK: temperature,
    bulkDensityGramsPerCm3: bulkDensityGramsPerCm3(input.massEarth, input.radiusEarth),
    polarCapExtentDeg: polarCapExtentDeg(planetClass, temperature),
    seed: seedFromId(input.id)
  };
}
