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
 * The brightness order, with each star's position and id laid out beside it in that order.
 *
 * A walk has to test every star it passes, and near the Sun it passes nearly all of them: a 4 pc
 * label radius holds a few dozen stars, faint dwarfs deep in the order, so the walk rarely finds
 * fifteen to name before the end. Reading the stars themselves in brightness order jumps all over
 * the catalogue, and a full walk took 19-23 ms — slower than the scan and sort it replaced. Read
 * from these arrays, laid out in the order they are walked, the same walk touches memory in
 * sequence and reads a star only when it yields one.
 */
export interface BrightnessIndex {
  /** Indices into the catalogue, brightest first. */
  readonly order: Uint32Array;
  /** Positions in the same order, three to a star, at full precision so a star on a radius stays on it. */
  readonly positions: Float64Array;
  readonly ids: Float64Array;
}

export function brightnessIndex<T extends BrightnessRanked & Positioned & { readonly id: number }>(stars: readonly T[]): BrightnessIndex {
  const order = brightnessOrder(stars);
  const positions = new Float64Array(order.length * 3);
  const ids = new Float64Array(order.length);
  order.forEach((index, at) => {
    const star = stars[index];
    positions[at * 3] = star.x;
    positions[at * 3 + 1] = star.y;
    positions[at * 3 + 2] = star.z;
    ids[at] = star.id;
  });
  return { order, positions, ids };
}

/**
 * The stars within `radiusPc` of `centre`, brightest first, plus the one star `alwaysId` names
 * wherever it is — handed over lazily, so a caller that stops after the first few pays for no
 * more than it read.
 */
export function* brightestWithin<T extends BrightnessRanked & Positioned & { readonly id: number }>(
  stars: readonly T[],
  index: BrightnessIndex,
  centre: Positioned,
  radiusPc: number,
  alwaysId: number | null
): Generator<T> {
  const { order, positions, ids } = index;
  const radiusSq = radiusPc * radiusPc;
  for (let at = 0; at < order.length; at++) {
    const dx = positions[at * 3] - centre.x;
    const dy = positions[at * 3 + 1] - centre.y;
    const dz = positions[at * 3 + 2] - centre.z;
    if (dx * dx + dy * dy + dz * dz <= radiusSq || ids[at] === alwaysId) {
      yield stars[order[at]];
    }
  }
}
