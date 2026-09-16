/**
 * The catalogue in order of brightness, worked out once and walked as often as needed.
 *
 * Two parts of the map want "the brightest stars in this region": the labels, which name about
 * fifteen of them five times a second, and the star field, which draws a budget of them. Sorting
 * the region each time is paid for every star in it. At the opening view the label region holds
 * some 60 000 stars, and sorting them to name fifteen took 55-70 ms a pass, a stall five times
 * a second on any machine. Walking one shared order and stopping when enough have been taken
 * costs only the stars looked at before that.
 */

export interface BrightnessRanked {
  readonly magnitude: number;
}

export interface Positioned {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Indices into `stars`, brightest (lowest magnitude) first. Ties keep catalogue order: typed-array
 * sort is required to be stable, exactly as the sort of the stars themselves was.
 */
export function brightnessOrder(stars: readonly BrightnessRanked[]): Uint32Array {
  return Uint32Array.from(stars.keys()).sort((a, b) => stars[a].magnitude - stars[b].magnitude);
}

/**
 * The stars within `radiusPc` of `centre`, brightest first, plus the one star `alwaysId` names
 * wherever it is — handed over lazily, so a caller that stops after the first few pays for no
 * more than it read.
 */
export function* brightestWithin<T extends BrightnessRanked & Positioned & { readonly id: number }>(
  stars: readonly T[],
  order: Uint32Array,
  centre: Positioned,
  radiusPc: number,
  alwaysId: number | null
): Generator<T> {
  const radiusSq = radiusPc * radiusPc;
  for (const index of order) {
    const star = stars[index];
    const dx = star.x - centre.x;
    const dy = star.y - centre.y;
    const dz = star.z - centre.z;
    if (dx * dx + dy * dy + dz * dz <= radiusSq || star.id === alwaysId) {
      yield star;
    }
  }
}
