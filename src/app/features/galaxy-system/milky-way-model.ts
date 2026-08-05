import {
  armRadiusPc,
  BAR_HALF_LENGTH_PC,
  BAR_HALF_THICKNESS_PC,
  BAR_HALF_WIDTH_PC,
  BAR_POSITION_ANGLE_DEG,
  DISC_RADIUS_PC,
  DISC_SCALE_HEIGHT_PC,
  DISC_SCALE_LENGTH_PC,
  galacticToEquatorial,
  MILKY_WAY_ARMS,
  ORION_SPUR,
  SpiralArm,
  SUN_GALACTOCENTRIC_RADIUS_PC,
  SUN_HEIGHT_ABOVE_MIDPLANE_PC
} from '../../shared/astro/galaxy';

const DEG_TO_RAD = Math.PI / 180;

/**
 * Particle budget per population. Between them these are ~46k instanced quads, which is the
 * same order as the star field and draws in a single call.
 */
export interface GalaxyParticleCounts {
  readonly arms: number;
  readonly disc: number;
  readonly bulge: number;
  readonly halo: number;
}

export const DEFAULT_PARTICLE_COUNTS: GalaxyParticleCounts = {
  arms: 24000,
  disc: 12000,
  bulge: 9000,
  halo: 1600
};

/** Vertical scale height of the star-forming ridge in an arm — much thinner than the disc. */
const ARM_SCALE_HEIGHT_PC = 130;
/** Fraction of arm particles drawn as bright star-forming knots rather than ordinary field. */
const HII_REGION_FRACTION = 0.05;

/** Particle diameters in parsecs. These are cloud-sized on purpose: the model is haze, not stars. */
const ARM_SIZE_PC = { min: 70, max: 240 } as const;
const DISC_SIZE_PC = { min: 120, max: 420 } as const;
const BULGE_SIZE_PC = { min: 90, max: 300 } as const;
const HALO_SIZE_PC = { min: 110, max: 260 } as const;
const HII_SIZE_MULTIPLIER = 1.9;

/**
 * The palette. Young blue-white stars trace the arms, star formation lights them pink, the
 * bar and bulge are old and red, and the smooth disc between the arms is a dim yellow-white.
 */
const ARM_INNER_COLOR = [0.62, 0.74, 1.0] as const;
const ARM_OUTER_COLOR = [0.78, 0.86, 1.0] as const;
const HII_COLOR = [1.0, 0.48, 0.66] as const;
const BULGE_CORE_COLOR = [1.0, 0.87, 0.64] as const;
const BULGE_EDGE_COLOR = [1.0, 0.68, 0.38] as const;
const DISC_COLOR = [0.72, 0.74, 0.82] as const;
const HALO_COLOR = [0.55, 0.6, 0.78] as const;

export interface GalaxyParticles {
  readonly count: number;
  /** Equatorial-frame positions in parsecs from the Sun, packed xyz. */
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  /** World-space diameter, in parsecs. */
  readonly sizes: Float32Array;
  readonly alphas: Float32Array;
}

/**
 * Small, fast, seedable PRNG (mulberry32). `Math.random` would do visually, but the model would
 * then be different on every reload and untestable — this way the Galaxy is the same Galaxy
 * every time, and a test can assert on where its particles land.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample, by the polar form of Box-Muller. */
function gaussian(random: () => number): number {
  let u = 0;
  let v = 0;
  let s = 0;
  do {
    u = random() * 2 - 1;
    v = random() * 2 - 1;
    s = u * u + v * v;
  } while (s === 0 || s >= 1);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * Turns a galactocentric offset in the plane (heliocentric-parallel axes: +X toward the centre,
 * +Y toward longitude 90) plus a height above the midplane into a heliocentric galactic
 * position. The polar form of the same mapping lives in `galaxy.ts`; the bar is easier to write
 * in Cartesian, so it gets this one.
 */
function fromCentreOffset(dx: number, dy: number, heightPc: number): { x: number; y: number; z: number } {
  return { x: SUN_GALACTOCENTRIC_RADIUS_PC + dx, y: dy, z: heightPc - SUN_HEIGHT_ABOVE_MIDPLANE_PC };
}

interface Writer {
  push(galactic: { x: number; y: number; z: number }, color: readonly number[], sizePc: number, alpha: number): void;
}

function createWriter(capacity: number): Writer & GalaxyParticles & { finish(): GalaxyParticles } {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  let count = 0;

  return {
    positions,
    colors,
    sizes,
    alphas,
    get count() {
      return count;
    },
    push(galactic, color, sizePc, alpha) {
      // Everything is modelled in galactic coordinates and rotated once, here, into the frame
      // the star field and orbits already share.
      const equatorial = galacticToEquatorial(galactic);
      positions[count * 3] = equatorial.x;
      positions[count * 3 + 1] = equatorial.y;
      positions[count * 3 + 2] = equatorial.z;
      colors[count * 3] = color[0];
      colors[count * 3 + 1] = color[1];
      colors[count * 3 + 2] = color[2];
      sizes[count] = sizePc;
      alphas[count] = alpha;
      count++;
    },
    finish() {
      return { count, positions, colors, sizes, alphas };
    }
  };
}

/** Picks an arm, weighted, so the two grand-design arms dominate the minor ones. */
function pickArm(random: () => number, arms: readonly SpiralArm[]): SpiralArm {
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0);
  let roll = random() * total;
  for (const arm of arms) {
    roll -= arm.weight;
    if (roll <= 0) {
      return arm;
    }
  }
  return arms[arms.length - 1];
}

function addArmParticles(writer: Writer, random: () => number, count: number): void {
  const arms = [...MILKY_WAY_ARMS, ORION_SPUR];

  for (let i = 0; i < count; i++) {
    const arm = pickArm(random, arms);
    // Biased toward the start of the sweep, which is the inner, denser end of every arm.
    const t = Math.pow(random(), 1.4);
    const beta = lerp(arm.fromAzimuthDeg, arm.toAzimuthDeg, t);
    const spineRadius = armRadiusPc(arm, beta);
    if (spineRadius > DISC_RADIUS_PC || spineRadius < BAR_HALF_LENGTH_PC * 0.5) {
      continue;
    }

    const offset = gaussian(random) * arm.widthPc;
    const radius = spineRadius + offset;
    if (radius <= 0) {
      continue;
    }
    const height = gaussian(random) * ARM_SCALE_HEIGHT_PC;
    const angle = beta * DEG_TO_RAD;
    const galactic = fromCentreOffset(-radius * Math.cos(angle), radius * Math.sin(angle), height);

    const radialT = Math.min(radius / DISC_RADIUS_PC, 1);
    const isHii = random() < HII_REGION_FRACTION;
    const color = isHii ? HII_COLOR : lerpColor(ARM_INNER_COLOR, ARM_OUTER_COLOR, radialT);
    const size = lerp(ARM_SIZE_PC.min, ARM_SIZE_PC.max, random()) * (isHii ? HII_SIZE_MULTIPLIER : 1);
    // Fades with radius (the arms thin out) and with distance off the spine (they have edges).
    const ridgeFalloff = Math.exp(-(offset * offset) / (2 * arm.widthPc * arm.widthPc));
    const alpha = (isHii ? 0.85 : 0.4) * ridgeFalloff * lerp(1, 0.35, radialT);

    writer.push(galactic, color, size, alpha);
  }
}

function addDiscParticles(writer: Writer, random: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    // Inverse-transform sample of an exponential disc, rejected past the visible edge.
    const radius = -DISC_SCALE_LENGTH_PC * Math.log(1 - random());
    // The inner cut is where the bulge takes over, not a hole: set it at the bar's short axis
    // rather than its long one, or the model has a visible gap either side of the bar.
    if (radius > DISC_RADIUS_PC || radius < BAR_HALF_WIDTH_PC) {
      continue;
    }
    const angle = random() * Math.PI * 2;
    const height = gaussian(random) * DISC_SCALE_HEIGHT_PC;
    const galactic = fromCentreOffset(-radius * Math.cos(angle), radius * Math.sin(angle), height);

    const radialT = Math.min(radius / DISC_RADIUS_PC, 1);
    writer.push(galactic, DISC_COLOR, lerp(DISC_SIZE_PC.min, DISC_SIZE_PC.max, random()), lerp(0.16, 0.03, radialT));
  }
}

/**
 * Share of the bulge budget spent on the bar rather than on the rounder spheroid it sits inside.
 * Both are needed: the bar alone leaves a void either side of its short axis, between it and the
 * radius the arms and disc start at.
 */
const BAR_SHARE_OF_BULGE = 0.6;
/** Gaussian width of the inner spheroid, and how much it is flattened toward the disc. */
const SPHEROID_SIGMA_PC = 1150;
const SPHEROID_FLATTENING = 0.62;

function addBulgeParticles(writer: Writer, random: () => number, count: number): void {
  const phi = BAR_POSITION_ANGLE_DEG * DEG_TO_RAD;
  const alongX = -Math.cos(phi);
  const alongY = Math.sin(phi);
  const acrossX = Math.sin(phi);
  const acrossY = Math.cos(phi);

  for (let i = 0; i < count; i++) {
    let dx: number;
    let dy: number;
    let height: number;
    let distance: number;

    if (random() < BAR_SHARE_OF_BULGE) {
      // A triaxial Gaussian: long down the bar, narrow across it, flattened vertically.
      const along = gaussian(random) * (BAR_HALF_LENGTH_PC / 2);
      const across = gaussian(random) * (BAR_HALF_WIDTH_PC / 2);
      height = gaussian(random) * (BAR_HALF_THICKNESS_PC / 2);
      dx = along * alongX + across * acrossX;
      dy = along * alongY + across * acrossY;
      distance = Math.hypot(along, across, height);
    } else {
      dx = gaussian(random) * SPHEROID_SIGMA_PC;
      dy = gaussian(random) * SPHEROID_SIGMA_PC;
      height = gaussian(random) * SPHEROID_SIGMA_PC * SPHEROID_FLATTENING;
      distance = Math.hypot(dx, dy, height);
    }

    const coreT = Math.min(distance / BAR_HALF_LENGTH_PC, 1);
    writer.push(
      fromCentreOffset(dx, dy, height),
      lerpColor(BULGE_CORE_COLOR, BULGE_EDGE_COLOR, coreT),
      lerp(BULGE_SIZE_PC.min, BULGE_SIZE_PC.max, random()),
      lerp(0.3, 0.06, coreT)
    );
  }
}

function addHaloParticles(writer: Writer, random: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    // A thin spherical scatter (globular clusters and halo field) so the disc is not a bare
    // plate floating in the void.
    const radius = DISC_RADIUS_PC * (0.35 + 0.85 * Math.pow(random(), 0.7));
    const cosTheta = random() * 2 - 1;
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const angle = random() * Math.PI * 2;
    const galactic = fromCentreOffset(radius * sinTheta * Math.cos(angle), radius * sinTheta * Math.sin(angle), radius * cosTheta);

    writer.push(galactic, HALO_COLOR, lerp(HALO_SIZE_PC.min, HALO_SIZE_PC.max, random()), 0.05);
  }
}

/**
 * Scatters the Milky Way's particle cloud around the structural model in `galaxy.ts` and returns
 * it packed for instanced rendering, already rotated into the scene's equatorial frame.
 *
 * Some samples are rejected (an arm particle that lands inside the bar, a disc particle past the
 * visible edge), so the returned `count` is a little below the requested budget — the arrays are
 * allocated at capacity and the count says how much of them is live.
 */
export function generateMilkyWayParticles(seed = 20260804, counts: GalaxyParticleCounts = DEFAULT_PARTICLE_COUNTS): GalaxyParticles {
  const random = createRandom(seed);
  const writer = createWriter(counts.arms + counts.disc + counts.bulge + counts.halo);

  addBulgeParticles(writer, random, counts.bulge);
  addArmParticles(writer, random, counts.arms);
  addDiscParticles(writer, random, counts.disc);
  addHaloParticles(writer, random, counts.halo);

  return writer.finish();
}
