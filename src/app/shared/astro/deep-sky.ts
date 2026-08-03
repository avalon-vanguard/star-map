import { DeepSkyDistanceMethod, DeepSkyKind } from '../models/deepsky.model';
import { parallaxMasToParsecs } from './coordinates';

/** Speed of light in km/s (exact, by definition of the metre). */
export const SPEED_OF_LIGHT_KM_S = 299792.458;

/**
 * Hubble constant in km/s/Mpc. The measured value is contested — "Hubble tension" — with
 * ~67 from the cosmic microwave background and ~73 from the local distance ladder; 70 is the
 * conventional round middle. Distances derived from it are good to roughly 10%, which is far
 * inside the tolerance needed to place a smudge of light on a backdrop.
 */
export const HUBBLE_CONSTANT_KM_S_PER_MPC = 70;

const PARSECS_PER_MEGAPARSEC = 1e6;

/**
 * Minimum redshift trusted for a Hubble-law distance, ≈900 km/s of recession or ~13 Mpc.
 *
 * Below this a galaxy's measured velocity is mostly its own motion through its group rather
 * than cosmological expansion, so `cz / H0` stops being a distance at all. Galaxies have
 * peculiar velocities of a few hundred km/s in any direction: the Local Group's members are
 * blueshifted outright (M31 approaches at ~300 km/s), and the Small Magellanic Cloud's small
 * positive redshift yields 2 Mpc against a true distance of 62 kpc — a 33-fold error.
 *
 * Cutting here trades coverage for honesty. Nearby galaxies come back with a `null` distance
 * instead of a confident wrong one, which is the right answer to show a user.
 */
const MIN_USABLE_REDSHIFT = 0.003;

/**
 * Upper bound on a parallax-derived distance, in parsecs. The Milky Way's disc is ~30 kpc
 * across, so a parallax implying more than this is measurement noise rather than a real
 * distance to a galactic object.
 */
const MAX_PARALLAX_DISTANCE_PC = 100000;

/**
 * OpenNGC object-type codes grouped into the three kinds the backdrop distinguishes.
 * Codes not listed here (`Dup` duplicates, `NonEx` non-existent entries, plain stars `*`,
 * doubles `**`, `Nova`, `Other`) are not deep-sky objects and are dropped.
 */
const KIND_BY_OPENNGC_TYPE: Readonly<Record<string, DeepSkyKind>> = {
  // Galaxies, and multi-galaxy systems.
  G: 'galaxy',
  GPair: 'galaxy',
  GTrpl: 'galaxy',
  GGroup: 'galaxy',
  // Nebulae of every flavour, including supernova remnants and cluster-with-nebulosity.
  PN: 'nebula',
  HII: 'nebula',
  EmN: 'nebula',
  RfN: 'nebula',
  Neb: 'nebula',
  DrkN: 'nebula',
  SNR: 'nebula',
  'Cl+N': 'nebula',
  // Star clusters and associations.
  OCl: 'cluster',
  GCl: 'cluster',
  '*Ass': 'cluster'
};

/** Maps an OpenNGC `Type` code to a backdrop kind, or `null` if it isn't a deep-sky object. */
export function classifyOpenNgcType(type: string | undefined | null): DeepSkyKind | null {
  return KIND_BY_OPENNGC_TYPE[(type ?? '').trim()] ?? null;
}

/**
 * Hubble-law distance for a cosmological redshift, in parsecs: `d = cz / H0`.
 * Returns `null` for a redshift too small (or negative) to be dominated by expansion —
 * see {@link MIN_USABLE_REDSHIFT}.
 */
export function redshiftToDistancePc(redshift: number | null): number | null {
  if (redshift === null || !Number.isFinite(redshift) || redshift < MIN_USABLE_REDSHIFT) {
    return null;
  }
  return ((SPEED_OF_LIGHT_KM_S * redshift) / HUBBLE_CONSTANT_KM_S_PER_MPC) * PARSECS_PER_MEGAPARSEC;
}

export interface DeepSkyDistanceEstimate {
  distancePc: number;
  method: DeepSkyDistanceMethod;
}

/**
 * Best-effort distance for a deep-sky object, with its provenance.
 *
 * Parallax is preferred for galactic objects (clusters, nebulae) where it is a direct
 * geometric measurement, but is *rejected outright for galaxies*: OpenNGC's parallax column
 * for a galaxy comes from a cross-matched foreground star, not the galaxy itself, and taking
 * it at face value is badly wrong — M31 lists 6 mas, implying 167 pc for something actually
 * ~780,000 pc away. Redshift is the fallback, and the only usable option for distant galaxies.
 *
 * Returns `null` when neither source is trustworthy, which is the honest answer for Local
 * Group members and for anything OpenNGC leaves unmeasured.
 */
export function estimateDeepSkyDistancePc(input: {
  kind: DeepSkyKind;
  redshift: number | null;
  parallaxMas: number | null;
}): DeepSkyDistanceEstimate | null {
  const { kind, redshift, parallaxMas } = input;

  if (kind !== 'galaxy' && parallaxMas !== null && Number.isFinite(parallaxMas) && parallaxMas > 0) {
    const distancePc = parallaxMasToParsecs(parallaxMas);
    if (Number.isFinite(distancePc) && distancePc <= MAX_PARALLAX_DISTANCE_PC) {
      return { distancePc, method: 'parallax' };
    }
  }

  const fromRedshift = redshiftToDistancePc(redshift);
  return fromRedshift === null ? null : { distancePc: fromRedshift, method: 'redshift' };
}

/**
 * Whether an object is notable enough for the backdrop. The full catalog is ~12,000 objects,
 * almost all of them faint anonymous galaxies that would render as visual noise; this keeps
 * the ones a person could actually pick out — everything in the Messier catalog, everything
 * with a common name, and anything else brighter than {@link NOTABLE_MAGNITUDE_LIMIT}.
 */
export const NOTABLE_MAGNITUDE_LIMIT = 9;

export function isNotableDeepSkyObject(input: {
  messier: string | null;
  commonName: string | null;
  magnitude: number | null;
}): boolean {
  if (input.messier || input.commonName) {
    return true;
  }
  return input.magnitude !== null && input.magnitude <= NOTABLE_MAGNITUDE_LIMIT;
}
