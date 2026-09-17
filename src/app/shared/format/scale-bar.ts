/**
 * The round lengths a map is read against: its scale bar, and the spacing of its distance rings.
 *
 * Round means 1, 2 or 5 times a power of ten — the only lengths a reader can add up at a glance,
 * which is why every printed map's scale bar uses them.
 */

/** The largest 1, 2 or 5 × a power of ten that is at most `value`, or `null` for no length at all. */
export function roundLengthAtMost(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const power = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / power;
  return (mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1) * power;
}

/**
 * Rings at a round step of about `reach / count`, out to `reach` or just past it, plus `callout`
 * wherever it falls among them: the grid's own radii are round, and the one radius that means
 * something in its own right is marked whether the step lands on it or not. Rounding the step
 * down makes for `count` to `2.5 × count` rings, never fewer than it takes to cover `reach`.
 */
export function distanceRings(reach: number, count: number, callout: number): number[] {
  const step = roundLengthAtMost(reach / count);
  if (step === null) {
    return [];
  }
  // `toPrecision` clears the binary noise of stepping by a tenth: 0.1 × 3 is 0.30000000000000004.
  const radii = Array.from({ length: Math.ceil(reach / step) }, (_, index) => Number((step * (index + 1)).toPrecision(12)));
  if (callout > step && callout < radii[radii.length - 1] && !radii.includes(callout)) {
    radii.push(callout);
    radii.sort((a, b) => a - b);
  }
  return radii;
}

export type LengthUnit = 'pc' | 'AU';

/** A round length, and how many pixels it spans at the current zoom. */
export interface ScaleBar {
  readonly label: string;
  readonly widthPx: number;
}

/**
 * The longest round length that fits in `maxWidthPx` when one pixel spans `unitsPerPx`.
 *
 * Under a perspective camera a pixel spans a different length at every depth, so the scene
 * measures `unitsPerPx` at the point the view is centred on, which is where the map is being
 * read. Under the plan view it is exact everywhere.
 */
export function scaleBar(unitsPerPx: number, maxWidthPx: number, unit: LengthUnit): ScaleBar | null {
  const length = roundLengthAtMost(unitsPerPx * maxWidthPx);
  if (length === null) {
    return null;
  }
  return { label: formatRoundLength(length, unit), widthPx: length / unitsPerPx };
}

/** A scale or ring length, in kiloparsecs past a thousand parsecs. */
export function formatRoundLength(length: number, unit: LengthUnit): string {
  if (unit === 'pc' && length >= 1000) {
    return `${digitsOf(length / 1000)} kpc`;
  }
  return `${digitsOf(length)} ${unit}`;
}

/** `0.05`, `2`, `150`, never `2.00`: these lengths have no digits past the ones that carry them. */
function digitsOf(value: number): string {
  return String(Number(value.toPrecision(3)));
}
