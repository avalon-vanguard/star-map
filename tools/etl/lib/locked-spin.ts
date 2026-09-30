import { eclipticToEquatorial, laplacePlaneToEquatorial } from '../../../src/app/shared/astro/coordinates';
import { meanElementsAt, positionAtEpoch } from '../../../src/app/shared/astro/kepler';
import { MeanOrbit } from '../../../src/app/shared/astro/mean-elements';
import { orientationAt } from '../../../src/app/shared/astro/rotational-elements';
import { BodyRecord, RotationalElements } from '../../../src/app/shared/models/body.model';

const J2000_JD = 2451545;
const DAYS_PER_JULIAN_CENTURY = 36525;
const DEG_TO_RAD = Math.PI / 180;

/** 2025-01-01, the date the ETL asks Horizons about: where a locked moon's W is left as the IAU has it. */
export const PRESENT_JD = 2460676.5;

/**
 * How far the IAU's W rate for a locked moon may be from the mean motion its orbit is drawn at, as
 * a fraction of it, before it is taken for the orbit's. Measured: at most 3.4e-6 (Iapetus; Proteus
 * 6.3e-7). What this catches is a rate read for the wrong body: Oberon's for Titania's is 55 per cent out.
 */
const MAX_LOCKED_RATE_OFFSET = 1e-5;

/** Harmonics of the node's angle that carry a pole round its orbit's; see {@link lockedToOrbit}. */
const POLE_HARMONICS = 5;

/**
 * How far a periodic term's angle may turn from a multiple of the node's rate, as a fraction of it,
 * and still be taken for the node's angle as the IAU's source had it. Measured: at most 3.1e-2
 * (Callisto's J6), then Rhea's R4 1.2e-2 and Ganymede's J5 3.3e-3; the nearest that is not a node is
 * a term of Miranda's W alone, 6.0e-2 from three times it. Multiples go up to the ninth, the most the
 * report takes (Triton's N7); past that, Umbriel's W has a term 1.0e-2 from ten times its node's.
 */
const MAX_NODE_RATE_OFFSET = 0.05;
const MAX_NODE_HARMONIC = 9;

/** The planet's east longitude on a moon's IAU body-fixed frame, from the moon's mean place, at a TDB date. */
export function subPlanetLongitudeDeg(body: Pick<BodyRecord, 'orbit' | 'rates' | 'laplacePole'>, elements: RotationalElements, jd: number): number {
  const own = positionAtEpoch(meanElementsAt(body.orbit, body.rates, jd));
  const place = body.laplacePole ? laplacePlaneToEquatorial(own, body.laplacePole) : eclipticToEquatorial(own);
  const { poleRaDeg, poleDecDeg, primeMeridianDeg } = orientationAt(elements, jd);
  const pole = { raDeg: poleRaDeg, decDeg: poleDecDeg };
  const w = primeMeridianDeg * DEG_TO_RAD;
  const meridian = laplacePlaneToEquatorial({ x: Math.cos(w), y: Math.sin(w), z: 0 }, pole);
  const east = laplacePlaneToEquatorial({ x: -Math.sin(w), y: Math.cos(w), z: 0 }, pole);
  const along = (axis: { x: number; y: number; z: number }) => -(place.x * axis.x + place.y * axis.y + place.z * axis.z);
  return Math.atan2(along(east), along(meridian)) / DEG_TO_RAD;
}

/**
 * A locked moon's IAU elements, turned at the rate its orbit is drawn at, so it keeps its face to
 * its planet over the clock's AD 1 to 3000 and not only near the present its W was fitted to.
 *
 * The report gives a locked moon's W the mean motion of whichever orbit its authors had, and JPL's
 * table has another: Proteus's W turns 6.3e-7 of its rate slower than its row, which turned its far
 * side to Neptune at AD 1 (146 degrees), Mimas's 1.6e-7 faster (52 at AD 1) and Miranda's (23).
 * W's rate is set to the orbit's here, its constant moved so W is unchanged at {@link PRESENT_JD}.
 * Measured over AD 1-3000: Proteus 2.7 degrees, Mimas 8.9, Miranda 2.4, Ariel 1.0. A W with a
 * quadratic is left: Phobos's orbit already takes the quadratic from W (see
 * `orbitalTermsOfPrimeMeridian`), and the Moon's, its tidal slowing, is 0.75 degrees at AD 1.
 *
 * The node's angle goes the same way. A moon in a Cassini state keeps its axis on its orbit normal,
 * which goes round the Laplace pole with the node, and the IAU's pole goes round with it on a term
 * of the node's angle, at the node's rate as its source had it, not quite JPL's current one the
 * orbit is drawn at (see `nodePeriodYears` in `fetchSolarSystem.ts`): Rhea's R4 turns 1.2 per cent
 * faster than its node, Callisto's J6 3.1 per cent, and Miranda's U11 0.013 per cent, which on a
 * 4.4-degree circle over twenty centuries still adds up. On the IAU's rates the axes part from the
 * drawn orbits by AD 1 or 3000: Rhea's by 0.77 degrees, Miranda's 0.59, Triton's 0.51, Europa's and
 * Callisto's 0.33. Every term whose angle turns within {@link MAX_NODE_RATE_OFFSET} of a multiple of
 * the node's rate is set to that multiple, its constant moved so the angle is unchanged at the
 * present, and the pole with it: over AD 1-3000 the axes of Io, Europa, Ganymede, Callisto, Rhea,
 * Miranda and Triton stay within 0.23 degrees of their orbit normals, and Mimas's, whose drawn node
 * takes the IAU's S3 itself, within 0.44. The rest of the pole and its terms are the IAU's, and so
 * are all of the Moon's and Phobos's, left whole with their W: Ariel's, Umbriel's, Titania's and
 * Oberon's poles go round on angles of their own at none of their nodes' multiples (Oberon's, the
 * nearest, 8.7 per cent from three times its node's rate), and their axes stay within 0.50 degrees
 * of their orbit normals without.
 *
 * `poleFollowsOrbit` is for Iapetus, whose IAU pole moves 3.9 degrees a century in right ascension
 * and 1.1 in declination: a straight line through its orbit normal's 3 439-year circle round the
 * Laplace pole, 8.3 degrees in radius (16.6 across), which by AD 1 has run past the celestial pole (Dec 97.9) and 11
 * degrees off the orbit, and turned its face 87 degrees from Saturn. Its axis sits on its orbit normal
 * (0.04 degrees apart today), as a moon in a Cassini state keeps it, so its pole is given the circle: the
 * normal's right ascension as sines and declination as cosines of the node's angle and its first
 * {@link POLE_HARMONICS} harmonics, the IAU's own form for a precessing pole, with its constants
 * set so the pole is the IAU's at the present. W counts from where the equator crosses the ICRF
 * equator, which swings as the pole goes round, so W takes sines of the same angles, fitted to hold
 * the face where it is today. Measured over AD 1-3000: the axis within 0.74 degrees of the orbit
 * normal (the IAU's line, 11.06), and the face within 16 of Saturn (87), which is what the row's own
 * 9.4-degree lag and its eccentricity make it from 1950 to 2100 as well (15.9).
 */
export function lockedToOrbit(elements: RotationalElements, mean: Pick<MeanOrbit, 'orbit' | 'rates' | 'laplacePole'>, name: string, poleFollowsOrbit = false): RotationalElements {
  const [w0, w1, w2 = 0] = elements.primeMeridianDeg;
  if (w2 !== 0) {
    return elements;
  }
  const n = Math.sign(w1) * mean.rates.meanMotionDegPerDay;
  if (Math.abs(w1 / n - 1) > MAX_LOCKED_RATE_OFFSET) {
    throw new Error(`${name}'s IAU W turns at ${w1} degrees a day, ${Math.abs(w1 / n - 1).toExponential(2)} of its orbit's ${n}: not the rate of the orbit it keeps its face to.`);
  }
  const nodeRate = mean.rates.longitudeOfAscendingNodeDegPerDay * DAYS_PER_JULIAN_CENTURY;
  const present = (PRESENT_JD - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  const terms = elements.terms?.map((term) => {
    const [constant, rate, quadratic = 0] = term.angleDeg;
    const k = Math.round(rate / nodeRate);
    if (quadratic !== 0 || k === 0 || Math.abs(k) > MAX_NODE_HARMONIC || Math.abs(rate / (k * nodeRate) - 1) > MAX_NODE_RATE_OFFSET) {
      return term;
    }
    return { ...term, angleDeg: [constant + (rate - k * nodeRate) * present, k * nodeRate] };
  });
  const locked: RotationalElements = { ...elements, primeMeridianDeg: [w0 + (w1 - n) * (PRESENT_JD - J2000_JD), n, 0], ...(terms ? { terms } : {}) };
  return poleFollowsOrbit ? poleRoundOrbit(locked, mean) : locked;
}

function poleRoundOrbit(elements: RotationalElements, mean: Pick<MeanOrbit, 'orbit' | 'rates' | 'laplacePole'>): RotationalElements {
  if (!mean.laplacePole) {
    throw new Error('A pole that follows its orbit is carried round the orbit\'s Laplace pole, and this orbit has none.');
  }
  const laplacePole = mean.laplacePole;
  const normalAt = (jd: number) => {
    const { inclinationDeg, longitudeOfAscendingNodeDeg } = meanElementsAt(mean.orbit, mean.rates, jd);
    const tilt = inclinationDeg * DEG_TO_RAD;
    const node = longitudeOfAscendingNodeDeg * DEG_TO_RAD;
    const normal = laplacePlaneToEquatorial({ x: Math.sin(tilt) * Math.sin(node), y: -Math.sin(tilt) * Math.cos(node), z: Math.cos(tilt) }, laplacePole);
    return { raDeg: Math.atan2(normal.y, normal.x) / DEG_TO_RAD, decDeg: Math.asin(normal.z) / DEG_TO_RAD };
  };
  // The node's angle, T in centuries, turned so that 0 is where the normal is furthest north: the
  // circle is then even in declination and odd in right ascension about it, as the form requires.
  const nodeRate = mean.rates.longitudeOfAscendingNodeDegPerDay * DAYS_PER_JULIAN_CENTURY;
  const nodeAtJ2000 = meanElementsAt(mean.orbit, mean.rates, J2000_JD).longitudeOfAscendingNodeDeg;
  const jdAtAngle = (angleDeg: number, phaseDeg: number) => J2000_JD + ((angleDeg - phaseDeg - nodeAtJ2000) / nodeRate) * DAYS_PER_JULIAN_CENTURY;
  let phase = 0;
  let northmost = -Infinity;
  for (let candidate = 0; candidate < 360; candidate += 0.01) {
    const dec = normalAt(jdAtAngle(0, candidate)).decDeg;
    if (dec > northmost) {
      northmost = dec;
      phase = candidate;
    }
  }
  const centre = laplacePole;
  const samples = 3600;
  const ra = new Array<number>(POLE_HARMONICS + 1).fill(0);
  const dec = new Array<number>(POLE_HARMONICS + 1).fill(0);
  for (let sample = 0; sample < samples; sample++) {
    const angle = (sample / samples) * 360;
    const normal = normalAt(jdAtAngle(angle, phase));
    const raOffset = ((((normal.raDeg - centre.raDeg) % 360) + 540) % 360) - 180;
    for (let k = 0; k <= POLE_HARMONICS; k++) {
      ra[k] += (2 / samples) * raOffset * Math.sin(k * angle * DEG_TO_RAD);
      dec[k] += ((k === 0 ? 1 : 2) / samples) * (normal.decDeg - centre.decDeg) * Math.cos(k * angle * DEG_TO_RAD);
    }
  }
  const terms = Array.from({ length: POLE_HARMONICS }, (_, index) => {
    const k = index + 1;
    return { angleDeg: [k * (nodeAtJ2000 + phase), k * nodeRate], ra: ra[k], dec: dec[k], pm: 0 };
  });
  const round: RotationalElements = { ...elements, poleRaDeg: [centre.raDeg, 0, 0], poleDecDeg: [centre.decDeg + dec[0], 0, 0], terms: [...(elements.terms ?? []), ...terms] };
  // The IAU's pole at the present, exactly: the fitted circle's constants moved onto it.
  const iau = orientationAt(elements, PRESENT_JD);
  const fitted = orientationAt(round, PRESENT_JD);
  round.poleRaDeg = [round.poleRaDeg[0] + iau.poleRaDeg - fitted.poleRaDeg, 0, 0];
  round.poleDecDeg = [round.poleDecDeg[0] + iau.poleDecDeg - fitted.poleDecDeg, 0, 0];
  // W's sines on the same angles, fitted over a turn of the node to what the face drifts by.
  const pm = new Array<number>(POLE_HARMONICS + 1).fill(0);
  const wSamples = 36000;
  for (let sample = 0; sample < wSamples; sample++) {
    const angle = (sample / wSamples) * 360;
    const drift = subPlanetLongitudeDeg(mean, round, jdAtAngle(angle, phase));
    for (let k = 1; k <= POLE_HARMONICS; k++) {
      pm[k] += (2 / wSamples) * drift * Math.sin(k * angle * DEG_TO_RAD);
    }
  }
  const ownTerms = elements.terms?.length ?? 0;
  const turned: RotationalElements = { ...round, terms: round.terms!.map((term, index) => (index < ownTerms ? term : { ...term, pm: pm[index - ownTerms + 1] })) };
  // And W the IAU's at the present.
  const shift = orientationAt(turned, PRESENT_JD).primeMeridianDeg - orientationAt(elements, PRESENT_JD).primeMeridianDeg;
  turned.primeMeridianDeg = [turned.primeMeridianDeg[0] - shift, turned.primeMeridianDeg[1], 0];
  return turned;
}
