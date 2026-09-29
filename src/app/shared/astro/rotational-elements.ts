import { RotationalElements } from '../models/body.model';

/**
 * Reads the IAU WGCCRE 2015 rotational elements from NAIF's text kernel `pck00011.tpc`, which the
 * ETL fetches (see `tools/etl/lib/pck.ts`), and evaluates them at a date.
 */

const J2000_JD = 2451545.0;
const DAYS_PER_JULIAN_CENTURY = 36525;
const DEG_TO_RAD = Math.PI / 180;

/**
 * The smallest periodic term kept, in degrees. A term turns the body, or tips its pole, by at most
 * its amplitude, and the largest a body is ever drawn is Jupiter filling the screen at 641 px of
 * radius, where 0.01 degrees moves a point on its surface by 0.11 px. In `pck00011.tpc` this
 * leaves out 32 terms: Mercury's four smaller librations (0.0011 degrees and less), eight of the
 * Moon's thirteen (0.0072 and less), the thirteen short-period terms of Mars's pole and meridian
 * (0.00024 and less; its three 0.42-1.59 degree long-period ones stay), one of Phobos's (0.0063),
 * Jupiter's five (0.0022 and less) and one of Europa's (0.009). Mimas's 44.85-degree libration,
 * Triton's 32-degree precession and Miranda's 4.4 are kept, down to Triton's 0.01.
 */
export const MIN_PERIODIC_TERM_DEG = 0.01;

/**
 * Every `NAME = ( values )` assignment in the kernel's data blocks. A data block runs from a line
 * holding only `\begindata` to one holding only `\begintext`; the kernel's own prose mentions both
 * tokens mid-sentence, which is why they are only read alone on a line. Exponents are written
 * the Fortran way, `-1.4D-12`.
 */
function pckVariables(text: string): Map<string, number[]> {
  const data = text
    .split(/^\s*\\begindata\s*$/m)
    .slice(1)
    .map((block) => block.split(/^\s*\\begintext\s*$/m)[0])
    .join('\n');
  const variables = new Map<string, number[]>();
  for (const [, name, value] of data.matchAll(/(\w+)\s*=\s*(\([^)]*\)|\S+)/g)) {
    variables.set(
      name,
      value
        .replace(/[()]/g, ' ')
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((token) => Number(token.replace(/d/i, 'e')))
    );
  }
  return variables;
}

/**
 * One body's elements, by its NAIF id: 399 for Earth, 301 for the Moon, 2000001 for Ceres.
 * Undefined where the kernel has none.
 *
 * The periodic terms' angles belong to the planet's whole system, `BODY5_NUT_PREC_ANGLES` for
 * Jupiter and its moons, each a polynomial in T whose degree `BODYn_MAX_PHASE_DEGREE` gives: 1
 * unless stated, 2 for Mars, where Phobos's angle carries the tidal acceleration that is drawing
 * it in. A term is kept if any of its three amplitudes reaches {@link MIN_PERIODIC_TERM_DEG};
 * the largest amplitude of each term left out comes back in `skippedDeg`, for the ETL to say so.
 */
export function parsePckRotationalElements(text: string, naifId: number): { elements: RotationalElements; skippedDeg: number[] } | undefined {
  const variables = pckVariables(text);
  const poleRaDeg = variables.get(`BODY${naifId}_POLE_RA`);
  const poleDecDeg = variables.get(`BODY${naifId}_POLE_DEC`);
  const primeMeridianDeg = variables.get(`BODY${naifId}_PM`);
  if (!poleRaDeg || !poleDecDeg || !primeMeridianDeg) {
    return undefined;
  }
  if (![...poleRaDeg, ...poleDecDeg, ...primeMeridianDeg].every(Number.isFinite)) {
    throw new Error(`Body ${naifId}'s pole or prime meridian did not parse.`);
  }

  const ra = variables.get(`BODY${naifId}_NUT_PREC_RA`) ?? [];
  const dec = variables.get(`BODY${naifId}_NUT_PREC_DEC`) ?? [];
  const pm = variables.get(`BODY${naifId}_NUT_PREC_PM`) ?? [];
  const system = naifId < 1000 ? Math.floor(naifId / 100) : undefined;
  const angles = system === undefined ? [] : (variables.get(`BODY${system}_NUT_PREC_ANGLES`) ?? []);
  const coefficients = (variables.get(`BODY${system}_MAX_PHASE_DEGREE`)?.[0] ?? 1) + 1;

  const terms: NonNullable<RotationalElements['terms']> = [];
  const skippedDeg: number[] = [];
  for (let index = 0; index < Math.max(ra.length, dec.length, pm.length); index++) {
    const term = { ra: ra[index] ?? 0, dec: dec[index] ?? 0, pm: pm[index] ?? 0 };
    const largest = Math.max(Math.abs(term.ra), Math.abs(term.dec), Math.abs(term.pm));
    if (largest === 0) {
      continue;
    }
    if (largest < MIN_PERIODIC_TERM_DEG) {
      skippedDeg.push(largest);
      continue;
    }
    const angleDeg = angles.slice(index * coefficients, (index + 1) * coefficients);
    if (angleDeg.length !== coefficients || !angleDeg.every(Number.isFinite)) {
      throw new Error(`Body ${naifId}'s periodic term ${index + 1} has no angle among BODY${system}_NUT_PREC_ANGLES.`);
    }
    terms.push({ angleDeg, ...term });
  }

  return {
    elements: { poleRaDeg, poleDecDeg, primeMeridianDeg, ...(terms.length > 0 ? { terms } : {}) },
    skippedDeg
  };
}

function polynomial(coefficients: readonly number[], x: number): number {
  return (coefficients[0] ?? 0) + (coefficients[1] ?? 0) * x + (coefficients[2] ?? 0) * x * x;
}

/** The pole's right ascension and declination and the prime meridian W, in degrees, at a TDB Julian date. */
export function orientationAt(elements: RotationalElements, jdTdb: number): { poleRaDeg: number; poleDecDeg: number; primeMeridianDeg: number } {
  const days = jdTdb - J2000_JD;
  const centuries = days / DAYS_PER_JULIAN_CENTURY;
  let poleRaDeg = polynomial(elements.poleRaDeg, centuries);
  let poleDecDeg = polynomial(elements.poleDecDeg, centuries);
  let primeMeridianDeg = polynomial(elements.primeMeridianDeg, days);
  for (const term of elements.terms ?? []) {
    const angle = polynomial(term.angleDeg, centuries) * DEG_TO_RAD;
    poleRaDeg += term.ra * Math.sin(angle);
    poleDecDeg += term.dec * Math.cos(angle);
    primeMeridianDeg += term.pm * Math.sin(angle);
  }
  return { poleRaDeg, poleDecDeg, primeMeridianDeg: ((primeMeridianDeg % 360) + 360) % 360 };
}

/**
 * What a locked moon's W says of its going round that a row of mean elements leaves out, as terms
 * of that row. W follows the moon's mean longitude, so a term of W that is the moon running ahead
 * of and behind its mean motion, rather than its pole nodding, is its orbit's too. Two are here,
 * and JPL's satellite table has a column for neither: Mimas's -44.85 degrees and Tethys's +2.23 on
 * the angle that turns 506.2 degrees a century, the 71-year libration of their 4:2 resonance, and
 * Phobos's quadratic, 12.72 degrees per century squared about J2000, the tidal acceleration
 * drawing it in. Carried by W and not by the orbit, they left the drawn Mimas up to 45 degrees from
 * where Horizons has it and its face as far from Saturn, and Phobos 11 degrees out by 2100.
 *
 * `angleRateDegPerCentury` names the term by its angle's rate; W's quadratic, where it has one, is
 * always taken. Both come back about `epochJd`, which is where `meanAnomalyTerms` counts T from:
 * the sine as its `c` and `s`, and the quadratic re-centred from J2000 onto that epoch, as `b` plus
 * what the re-centring adds to the mean motion and to the mean anomaly at the epoch.
 */
export function orbitalTermsOfPrimeMeridian(
  elements: RotationalElements,
  epochJd: number,
  angleRateDegPerCentury?: number
): { meanAnomalyTerms: { b: number; c: number; s: number; f: number }; meanMotionDegPerDay: number; meanAnomalyDeg: number } {
  const epochCenturies = (epochJd - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  // W turns clockwise about the pole the IAU names where its rate is negative; the orbit does not.
  const sense = Math.sign(elements.primeMeridianDeg[1]);
  const quadratic = sense * (elements.primeMeridianDeg[2] ?? 0) * DAYS_PER_JULIAN_CENTURY * DAYS_PER_JULIAN_CENTURY;
  let sine = { c: 0, s: 0, f: 0 };
  if (angleRateDegPerCentury !== undefined) {
    const term = elements.terms?.find((candidate) => candidate.angleDeg[1] === angleRateDegPerCentury);
    if (!term || (term.angleDeg[2] ?? 0) !== 0) {
      throw new Error(`No term of W turns linearly at ${angleRateDegPerCentury} degrees a century.`);
    }
    const phase = (term.angleDeg[0] + term.angleDeg[1] * epochCenturies) * DEG_TO_RAD;
    sine = { c: sense * term.pm * Math.sin(phase), s: sense * term.pm * Math.cos(phase), f: term.angleDeg[1] };
  }
  // q (T + T0)², T from the epoch and T0 the epoch from J2000, is q T² + 2 q T0 T + q T0².
  return {
    meanAnomalyTerms: { b: quadratic, ...sine },
    meanMotionDegPerDay: (2 * quadratic * epochCenturies) / DAYS_PER_JULIAN_CENTURY,
    meanAnomalyDeg: quadratic * epochCenturies * epochCenturies
  };
}
