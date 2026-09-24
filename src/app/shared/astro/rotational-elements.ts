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
