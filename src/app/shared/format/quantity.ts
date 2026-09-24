/**
 * Formatting for every physical quantity the HUD and the body cards display.
 *
 * Shared rather than per-component so the same measurement reads identically wherever it
 * appears. The rule throughout is that precision follows magnitude — a figure is shown to the
 * digits that carry information at its own scale, not to a fixed decimal count that reads as
 * false precision at one end (`0.00 pc`) and loses real information at the other (`26000 pc`).
 */

/** Distance in parsecs, switching to kiloparsecs where the number would otherwise run long. */
export function formatParsecs(distancePc: number): string {
  const { divisor, digits, unit } = parsecScale(distancePc);
  return `${(distancePc / divisor).toFixed(digits)} ${unit}`;
}

function parsecScale(distancePc: number): { divisor: number; digits: number; unit: string } {
  return distancePc >= 1000 ? { divisor: 1000, digits: 1, unit: 'kpc' } : { divisor: 1, digits: distancePc < 10 ? 2 : 0, unit: 'pc' };
}

/**
 * A star's distance with its uncertainty, given as a fraction of it: `117 ± 12 pc`, to the
 * digits the distance itself is shown to. Left off where it is 1 % or less, or would round to
 * nothing at those digits, since the figure is then already as good as it reads.
 *
 * Past a fifth, a range: the distance is the inverse of a parallax, so the parallax's symmetric
 * error bar is a lopsided one in distance — Alnilam's 1.65 ± 0.45 mas is 476 to 833 pc, not
 * 606 ± 165. Only a Hipparcos or archive distance gets there; Gaia's query stops at a fifth. An
 * error as large as the parallax leaves no upper bound at all.
 */
export function formatDistance(distancePc: number, relativeError: number | undefined): string {
  if (relativeError === undefined || relativeError <= 0.01) {
    return formatParsecs(distancePc);
  }
  if (relativeError < 0.2) {
    const { divisor, digits, unit } = parsecScale(distancePc);
    const error = ((distancePc * relativeError) / divisor).toFixed(digits);
    return Number(error) === 0 ? formatParsecs(distancePc) : `${(distancePc / divisor).toFixed(digits)} ± ${error} ${unit}`;
  }
  const nearest = formatParsecs(distancePc / (1 + relativeError));
  return relativeError >= 1 ? `${nearest} or more` : `${nearest} to ${formatParsecs(distancePc / (1 - relativeError))}`;
}

/** Distance in astronomical units, for anything inside a system. */
export function formatAu(distanceAu: number): string {
  if (distanceAu < 0.01) {
    // Close-in exoplanets: 0.0026 AU is a real, published semi-major axis, and two decimals
    // would round every hot Jupiter in the catalogue to the same `0.00`.
    return `${distanceAu.toFixed(4)} AU`;
  }
  return distanceAu >= 100 ? `${distanceAu.toFixed(0)} AU` : `${distanceAu.toFixed(2)} AU`;
}

/**
 * Orbital period in whichever unit reads naturally at its length — hours for the very short
 * periods common among hot Jupiters, days up to a couple of years, then years.
 */
export function formatPeriod(days: number): string {
  if (days < 1) {
    return `${(days * 24).toFixed(1)} h`;
  }
  if (days < 700) {
    return `${days.toFixed(days < 10 ? 2 : 1)} d`;
  }
  return `${(days / 365.25).toFixed(days / 365.25 < 100 ? 1 : 0)} yr`;
}

/** Radius in kilometres. */
export function formatRadiusKm(radiusKm: number): string {
  // Grouped on both sides of the decimal threshold: 69,911 km beside a bare 6371 km reads as two
  // different conventions rather than one.
  const digits = radiusKm < 100 ? 1 : 0;
  return `${radiusKm.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

/** Mass in Earth masses. */
export function formatMassEarth(massEarth: number): string {
  if (massEarth >= 100) {
    return `${massEarth.toFixed(0)} M⊕`;
  }
  return `${massEarth.toFixed(massEarth < 1 ? 3 : 2)} M⊕`;
}

/** Equilibrium temperature. Always a whole kelvin — the model is not good to a fraction of one. */
export function formatTemperature(kelvin: number): string {
  return `${Math.round(kelvin)} K`;
}

/** Bulk density. */
export function formatDensity(gramsPerCm3: number): string {
  return `${gramsPerCm3.toFixed(2)} g/cm³`;
}

/** Bolometric luminosity in solar units, which spans many orders of magnitude. */
export function formatLuminosity(solar: number): string {
  if (solar >= 1000 || (solar > 0 && solar < 0.001)) {
    const exponent = Math.floor(Math.log10(solar));
    return `${(solar / Math.pow(10, exponent)).toFixed(1)}×10${superscript(exponent)} L☉`;
  }
  return `${solar.toFixed(solar < 1 ? 3 : 2)} L☉`;
}

function superscript(value: number): string {
  return `${value}`.replace('-', '⁻').replace(/\d/g, (digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]);
}
