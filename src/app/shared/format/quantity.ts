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
  return distancePc >= 1000 ? `${(distancePc / 1000).toFixed(1)} kpc` : `${distancePc.toFixed(distancePc < 10 ? 2 : 0)} pc`;
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
