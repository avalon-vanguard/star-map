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
 * Rings across the span from `nearest` to `reach`, at a round step of about a `count`th of it,
 * plus `callout` where it falls between the first ring and the last: the grid's own radii are
 * round, and the one radius that means something in its own right is marked whether the step lands
 * on it or not. A frame that stops short of it gets it only when the last ring — the first multiple
 * of `step` at or past `reach` — is past it: reach 245 with a 20 pc step gets it, reach 235 does
 * not, since its last ring is 240.
 *
 * Two numbers rather than one because these rings are centred on a fixed point — the Sun — and a
 * frame need not be. Looking at something 200 pc out from 20 pc away, what is on screen is a band
 * 200 pc wide at its narrowest and nowhere near the Sun; a step sized to the whole 220 puts every
 * ring off the frame. The span is what the frame covers, so the step is what it can resolve.
 *
 * Rounding the step down, over a span that need not start at the Sun, makes for `count` to
 * `ceil(2.5 × count) + 2` rings — `ceil(reach / step) - floor(nearest / step) + 1` — and the
 * callout can add one: 5 to 16 for a count of 5.
 */
export function distanceRings(nearest: number, reach: number, count: number, callout: number): number[] {
  const step = roundLengthAtMost((reach - nearest) / count);
  if (step === null) {
    return [];
  }
  // The ring just inside the near edge of the span, so the band is crossed rather than started at.
  const first = Math.max(1, Math.floor(nearest / step));
  const last = Math.ceil(reach / step);
  // `toPrecision` clears the binary noise of stepping by a tenth: 0.1 × 3 is 0.30000000000000004.
  const radii = Array.from({ length: last - first + 1 }, (_, index) => Number((step * (first + index)).toPrecision(12)));
  if (callout > radii[0] && callout < radii[radii.length - 1] && !radii.includes(callout)) {
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
