import { CartesianCoordinates, raDegDecDistanceToXyz } from './coordinates';

const DEG_TO_RAD = Math.PI / 180;

/**
 * Structural model of the Milky Way, and the rotation that carries it into the equatorial
 * frame the rest of the scene works in.
 *
 * **This is a model, not a catalogue.** Every other dataset in this app is measured: HYG gives
 * real parallaxes, Horizons real ephemerides, the Exoplanet Archive real orbits. The Galaxy is
 * different — we sit inside it, and dust blocks the view across the disc, so no catalogue holds
 * the positions of its stars. What *is* measured is its skeleton: the distance to the centre,
 * the tilt of the disc against the sky, and the radius/pitch/azimuth of each spiral arm from
 * maser parallaxes. Those measurements are the constants below; the individual particles the
 * renderer scatters around them are illustrative, and labelled as such in the UI.
 */

/**
 * Direction of the galactic centre (Sgr A*) and the north galactic pole, in equatorial J2000.
 * These two directions are what tie the model to the sky: everything else is built in galactic
 * coordinates and rotated through them.
 */
export const GALACTIC_CENTRE_RA_DEG = 266.4051;
export const GALACTIC_CENTRE_DEC_DEG = -28.936175;
export const NORTH_GALACTIC_POLE_RA_DEG = 192.85948;
export const NORTH_GALACTIC_POLE_DEC_DEG = 27.12825;

/**
 * Sun-to-galactic-centre distance, in parsecs (GRAVITY Collaboration 2019, from the orbit of
 * S2 around Sgr A*), and the Sun's height above the disc midplane.
 */
export const SUN_GALACTOCENTRIC_RADIUS_PC = 8178;
export const SUN_HEIGHT_ABOVE_MIDPLANE_PC = 20.8;

/** Rough visible extent of the stellar disc, and its exponential scale length/height. */
export const DISC_RADIUS_PC = 16000;
export const DISC_SCALE_LENGTH_PC = 2600;
export const DISC_SCALE_HEIGHT_PC = 300;

/** Boxy/peanut bulge and bar: half-length, half-width, half-thickness, and orientation. */
export const BAR_HALF_LENGTH_PC = 4200;
export const BAR_HALF_WIDTH_PC = 1300;
export const BAR_HALF_THICKNESS_PC = 900;
/** Angle between the bar's long axis and the Sun-centre line, near end at positive longitude. */
export const BAR_POSITION_ANGLE_DEG = 25;

/**
 * A spiral arm as a logarithmic spiral: `R(beta) = referenceRadiusPc * exp(-(beta -
 * referenceAzimuthDeg) * tan(pitchAngleDeg))`.
 *
 * `beta` is the galactocentric azimuth measured from the Sun's direction, increasing in the
 * direction of galactic rotation — the convention used by the maser-parallax surveys these
 * figures approximate (Reid et al. 2019). Values are rounded; they place each arm on the right
 * side of the Sun at the right pitch, which is what the view needs, and are not a substitute
 * for the published fits.
 */
export interface SpiralArm {
  readonly name: string;
  readonly referenceRadiusPc: number;
  readonly referenceAzimuthDeg: number;
  readonly pitchAngleDeg: number;
  /** Azimuth range to trace the arm over, in the same `beta` convention. */
  readonly fromAzimuthDeg: number;
  readonly toAzimuthDeg: number;
  /**
   * Where along the arm to anchor its name. Staggered between arms on purpose: anchoring them
   * all at one azimuth stacks five labels on the same radial line, which is unreadable.
   */
  readonly labelAzimuthDeg: number;
  /** Half-width of the star-forming ridge, in parsecs — how far particles scatter off the spine. */
  readonly widthPc: number;
  /** Relative particle density, so the two grand-design arms read as the dominant pair. */
  readonly weight: number;
}

export const MILKY_WAY_ARMS: readonly SpiralArm[] = [
  { name: 'Norma', referenceRadiusPc: 4460, referenceAzimuthDeg: 18, pitchAngleDeg: 1, fromAzimuthDeg: -20, toAzimuthDeg: 200, labelAzimuthDeg: 120, widthPc: 500, weight: 0.7 },
  { name: 'Scutum–Centaurus', referenceRadiusPc: 4910, referenceAzimuthDeg: 23, pitchAngleDeg: 12.1, fromAzimuthDeg: -30, toAzimuthDeg: 290, labelAzimuthDeg: 70, widthPc: 700, weight: 1 },
  { name: 'Sagittarius–Carina', referenceRadiusPc: 6040, referenceAzimuthDeg: 24, pitchAngleDeg: 17.1, fromAzimuthDeg: -40, toAzimuthDeg: 230, labelAzimuthDeg: -20, widthPc: 650, weight: 0.95 },
  { name: 'Perseus', referenceRadiusPc: 8870, referenceAzimuthDeg: 40, pitchAngleDeg: 10.3, fromAzimuthDeg: -60, toAzimuthDeg: 220, labelAzimuthDeg: 90, widthPc: 700, weight: 1 },
  { name: 'Outer', referenceRadiusPc: 12240, referenceAzimuthDeg: 18, pitchAngleDeg: 3, fromAzimuthDeg: -60, toAzimuthDeg: 200, labelAzimuthDeg: 30, widthPc: 800, weight: 0.55 }
];

/**
 * The Orion Spur — the minor arm the Sun sits in, which is why the local star field is not
 * empty. Short, so it is described by its own azimuth span rather than the full sweep above.
 */
export const ORION_SPUR: SpiralArm = {
  name: 'Orion Spur',
  referenceRadiusPc: 8260,
  referenceAzimuthDeg: 8.9,
  pitchAngleDeg: 11.4,
  fromAzimuthDeg: -25,
  toAzimuthDeg: 45,
  labelAzimuthDeg: 20,
  widthPc: 400,
  weight: 0.45
};

/**
 * Galactocentric radius of a point on an arm at azimuth `betaDeg`, in parsecs.
 * Diverges for large negative azimuths by construction — a logarithmic spiral has no
 * outer end — so callers trace it only over the arm's own azimuth range.
 */
export function armRadiusPc(arm: SpiralArm, betaDeg: number): number {
  return arm.referenceRadiusPc * Math.exp(-(betaDeg - arm.referenceAzimuthDeg) * DEG_TO_RAD * Math.tan(arm.pitchAngleDeg * DEG_TO_RAD));
}

/**
 * Converts galactocentric cylindrical coordinates into heliocentric galactic Cartesian
 * coordinates in parsecs: +X toward the galactic centre, +Y toward galactic longitude 90
 * (the direction of the Sun's rotation about the centre), +Z toward the north galactic pole.
 *
 * `heightPc` is measured from the disc midplane, not from the Sun — so a point with
 * `heightPc = 0` comes out at `z = -SUN_HEIGHT_ABOVE_MIDPLANE_PC`, since the Sun sits a little
 * above the plane it orbits in.
 */
export function galactocentricToHeliocentricGalactic(radiusPc: number, azimuthDeg: number, heightPc: number): CartesianCoordinates {
  const beta = azimuthDeg * DEG_TO_RAD;
  return {
    x: SUN_GALACTOCENTRIC_RADIUS_PC - radiusPc * Math.cos(beta),
    y: radiusPc * Math.sin(beta),
    z: heightPc - SUN_HEIGHT_ABOVE_MIDPLANE_PC
  };
}

function normalize(v: CartesianCoordinates): CartesianCoordinates {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function cross(a: CartesianCoordinates, b: CartesianCoordinates): CartesianCoordinates {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/**
 * The galactic frame's basis vectors, expressed in the equatorial frame.
 *
 * Built from the two catalogue directions above, which are given to finite precision and so are
 * not exactly perpendicular. The pole is taken as authoritative for "up" and the centre
 * direction is re-orthogonalised against it, which keeps the result an exact rotation — a basis
 * that is a fraction of an arcsecond off square would shear the whole model.
 */
const GALACTIC_POLE_EQUATORIAL = raDegDecDistanceToXyz(NORTH_GALACTIC_POLE_RA_DEG, NORTH_GALACTIC_POLE_DEC_DEG, 1);
const GALACTIC_CENTRE_EQUATORIAL = raDegDecDistanceToXyz(GALACTIC_CENTRE_RA_DEG, GALACTIC_CENTRE_DEC_DEG, 1);
const GALACTIC_Z = normalize(GALACTIC_POLE_EQUATORIAL);
const GALACTIC_Y = normalize(cross(GALACTIC_Z, GALACTIC_CENTRE_EQUATORIAL));
const GALACTIC_X = cross(GALACTIC_Y, GALACTIC_Z);

export const GALACTIC_BASIS_EQUATORIAL = {
  x: GALACTIC_X,
  y: GALACTIC_Y,
  z: GALACTIC_Z
} as const;

/** Rotates a heliocentric galactic vector into the scene's equatorial frame. */
export function galacticToEquatorial(v: CartesianCoordinates): CartesianCoordinates {
  return {
    x: GALACTIC_X.x * v.x + GALACTIC_Y.x * v.y + GALACTIC_Z.x * v.z,
    y: GALACTIC_X.y * v.x + GALACTIC_Y.y * v.y + GALACTIC_Z.y * v.z,
    z: GALACTIC_X.z * v.x + GALACTIC_Y.z * v.y + GALACTIC_Z.z * v.z
  };
}

/** Rotates an equatorial vector into heliocentric galactic coordinates (the inverse rotation). */
export function equatorialToGalactic(v: CartesianCoordinates): CartesianCoordinates {
  return {
    x: GALACTIC_X.x * v.x + GALACTIC_X.y * v.y + GALACTIC_X.z * v.z,
    y: GALACTIC_Y.x * v.x + GALACTIC_Y.y * v.y + GALACTIC_Y.z * v.z,
    z: GALACTIC_Z.x * v.x + GALACTIC_Z.y * v.y + GALACTIC_Z.z * v.z
  };
}

/** The galactic centre's position in the scene's equatorial frame, in parsecs from the Sun. */
export function galacticCentrePositionPc(): CartesianCoordinates {
  return galacticToEquatorial(galactocentricToHeliocentricGalactic(0, 0, 0));
}

/**
 * Named landmarks worth pinning in the galactic view. Positions are derived from the same
 * structural constants as the model, so a label always sits on the feature it names.
 */
export interface GalacticLandmark {
  readonly id: string;
  readonly name: string;
  /** Galactocentric radius/azimuth, matching {@link galactocentricToHeliocentricGalactic}. */
  readonly radiusPc: number;
  readonly azimuthDeg: number;
}

export const GALACTIC_LANDMARKS: readonly GalacticLandmark[] = [
  { id: 'sgr-a', name: 'Sagittarius A*', radiusPc: 0, azimuthDeg: 0 },
  { id: 'sol', name: 'Sol', radiusPc: SUN_GALACTOCENTRIC_RADIUS_PC, azimuthDeg: 0 },
  ...MILKY_WAY_ARMS.map((arm) => ({
    id: `arm-${arm.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name: `${arm.name} Arm`,
    radiusPc: armRadiusPc(arm, arm.labelAzimuthDeg),
    azimuthDeg: arm.labelAzimuthDeg
  })),
  { id: 'arm-orion-spur', name: 'Orion Spur', radiusPc: armRadiusPc(ORION_SPUR, ORION_SPUR.labelAzimuthDeg), azimuthDeg: ORION_SPUR.labelAzimuthDeg }
];

/** A landmark's position in the scene's equatorial frame, in parsecs from the Sun. */
export function landmarkPositionPc(landmark: GalacticLandmark): CartesianCoordinates {
  return galacticToEquatorial(galactocentricToHeliocentricGalactic(landmark.radiusPc, landmark.azimuthDeg, 0));
}
