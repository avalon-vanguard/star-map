/**
 * Reads the physical-data block at the top of a JPL Horizons object page, which the ETL fetches
 * (see `tools/etl/lib/horizons.ts`). Every page is written by hand, so each quantity is stated in
 * several ways; the patterns below are the ones the bodies in `bodies.json` actually use.
 */

/**
 * What follows the `=`: one radius, or a triaxial body's three semi-axes as `240x234.2x232.9`,
 * as Miranda's and Ariel's pages give them.
 */
const RADIUS_VALUE = String.raw`=\s*([\d.]+(?:\s*x\s*[\d.]+)*)`;
const RADIUS_PATTERNS = [
  new RegExp(String.raw`Vol\.?\s*mean\s*radius[^=]*${RADIUS_VALUE}`, 'i'),
  new RegExp(String.raw`Mean\s*radius[^=]*${RADIUS_VALUE}`, 'i'),
  new RegExp(String.raw`Radius\s*\(IAU\)[^=]*${RADIUS_VALUE}`, 'i'),
  // Charon's page says `Radius (km, IAU2015) = 606`.
  new RegExp(String.raw`Radius,?\s*\(km(?:,\s*IAU\s*2015)?\)\s*${RADIUS_VALUE}`, 'i'),
  new RegExp(String.raw`Radius\s*\(gravity\),?\s*km\s*${RADIUS_VALUE}`, 'i')
];

/**
 * How each page states how fast the body turns, in the order they are tried.
 *
 * The rate in radians per second is preferred wherever it appears: it is unambiguous and it is
 * signed: Venus and Uranus carry a negative one. A period in hours and minutes comes next, as the
 * giant planets and Phoebe state it, then one in hours or days, and finally the word most moons
 * carry instead of a number, Synchronous. Not all do — the Moon's page gives a rate, Titan's
 * nothing — so the caller treats every moon it lists as locked whatever its page says.
 */
const ROTATION_RATE_PATTERN = /Rot(?:ational)?\.?\s*Rate\s*[(,]\s*rad\/s\s*\)?\s*=\s*(-?[\d.]+)/i;
/**
 * `9h 55m 29.711 s`, as Jupiter and Saturn state it, and `9h 16.438 m`, as Phoebe does: read as
 * a period in hours alone, Phoebe turned once in 9 hours instead of 9.274.
 */
const SEXAGESIMAL_ROTATION_PATTERN = /(?:Sid(?:ereal|\.)?\s*rot\.?|Rotation(?:al)?)\s*period[^=]*=\s*(\d+)\s*h\s*([\d.]+)\s*m(?:\s*([\d.]+)\s*s)?/i;
const ROTATION_PERIOD_PATTERNS = [
  /Sid(?:ereal|\.)?\s*rot\.?\s*period[^=]*=\s*(-?[\d.]+)(?:\+-[\d.]+)?\s*(h|hr|hrs|d|day|days)\b/i,
  /Rotation(?:al)?\s*period[^=]*=\s*(-?[\d.]+)\s*(h|hr|hrs|d|day|days)\b/i
];
const SYNCHRONOUS_PATTERN = /Rotation(?:al)?\s*period\s*=?\s*:?\s*Synchronous/i;
/** `25.19 deg` on most pages, `2.11' +/- 0.1'` in arcminutes on Mercury's. */
const OBLIQUITY_PATTERN = /Obliquity\s*to\s*orbit[^=]*=\s*(-?[\d.]+)\s*(')?/i;
/** `GM (km^3/s^2) = 106.10` on a moon's page, `GM (planet) km^3/s^2 = 869.326` on Pluto's. */
const GM_PATTERN = /GM\s*(?:\(planet\)\s*)?,?\s*\(?km\^3\/s\^2\)?\s*=\s*([\d.]+)/i;

const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = 3600;

/**
 * True where the page gives no number because the body keeps one face to its parent, so its day
 * is its orbit. The period itself is then the orbit's, which the caller takes from the body's
 * mean motion.
 */
export function isTidallyLocked(text: string): boolean {
  return SYNCHRONOUS_PATTERN.test(text);
}

/** Sidereal rotation period, in hours, from whichever form the page states it in. */
export function extractRotationPeriodHours(text: string): number | undefined {
  const rate = text.match(ROTATION_RATE_PATTERN);
  if (rate && Number(rate[1]) !== 0) {
    return (2 * Math.PI) / (Number(rate[1]) * SECONDS_PER_HOUR);
  }
  const sexagesimal = text.match(SEXAGESIMAL_ROTATION_PATTERN);
  if (sexagesimal) {
    return Number(sexagesimal[1]) + Number(sexagesimal[2]) / 60 + Number(sexagesimal[3] ?? 0) / SECONDS_PER_HOUR;
  }
  for (const pattern of ROTATION_PERIOD_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const hours = Number(match[1]) * (match[2].toLowerCase().startsWith('d') ? HOURS_PER_DAY : 1);
      return Number.isFinite(hours) && hours !== 0 ? hours : undefined;
    }
  }
  return undefined;
}

/**
 * Tilt of the rotation axis from the orbit, in degrees. Mercury's page gives its tilt in
 * arcminutes, which read as degrees made it 2.11 where the IAU's pole puts it at 0.034.
 */
export function extractObliquityDeg(text: string): number | undefined {
  const match = text.match(OBLIQUITY_PATTERN);
  return match ? Number(match[1]) / (match[2] ? 60 : 1) : undefined;
}

/**
 * Mean radius in km. For a triaxial body, the radius of the sphere of the same volume, the cube
 * root of the three semi-axes' product, which is how the IAU states a mean radius: Miranda's
 * 240 x 234.2 x 232.9 km is 235.7, where the first figure alone overstated it by 2 per cent.
 */
export function extractRadiusKm(text: string): number | undefined {
  for (const pattern of RADIUS_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const axes = match[1].split('x').map(Number);
      return axes.reduce((product, axis) => product * axis, 1) ** (1 / axes.length);
    }
  }
  return undefined;
}

/** The body's own GM, in km³/s², where the page publishes one. */
export function extractGmKm3PerS2(text: string): number | undefined {
  const match = text.match(GM_PATTERN);
  return match ? Number(match[1]) : undefined;
}
