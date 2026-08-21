/**
 * Which stars are within reach of which, and how to get from one to another through them.
 *
 * A "jump link" is nothing more than a pair of catalogued stars closer together than some
 * chosen range. It is not a feature of space — there are no corridors out there — it is a
 * question asked of the catalogue: if a crossing of at most this far can be made, which stars
 * can be strung together, and what is the shortest chain from here to there.
 *
 * Two facts about the catalogue shape everything here, and both are worth stating because the
 * answers look like defects otherwise. It is magnitude-limited, so it is dense around the Sun
 * and thins with distance: within 50 pc a 3 pc range links 99% of it into one piece, while over
 * the whole 250 pc reach the same range leaves most stars alone. And a gap in it is a gap in
 * what has been catalogued, not in what is there. So a route that cannot be found is a
 * statement about the map, and `minimumRangeBetween` exists to say which.
 */

import { StarNeighbourhood } from './star-neighbourhood';

/** A chain of stars from one to another, each hop within the range that was asked for. */
export interface Route {
  /** Star ids, departure first and destination last. One hop is two ids. */
  readonly stars: readonly number[];
  /** The sum of the hops, in parsecs. */
  readonly totalPc: number;
  /**
   * The longest single hop. The range has to cover this and nothing wider, so it is what a
   * reader checks a route against — and it is the figure `minimumRangeBetween` minimises.
   */
  readonly longestHopPc: number;
}

/** An unordered pair of stars within range of each other. */
export interface JumpLink {
  readonly from: number;
  readonly to: number;
  readonly distancePc: number;
}

/**
 * A cap on how much of the catalogue one search may walk. Reached only where a route does not
 * exist and the range is wide enough to make most of the catalogue one component; a search that
 * hits it has already visited more stars than any real chain passes through.
 */
const MAX_VISITED = 20000;

/** Pops the smallest-cost entry. A linear scan: the frontier is small next to the work per node. */
function takeCheapest<T>(frontier: Map<number, T>, costOf: (value: T) => number): [number, T] | undefined {
  let bestId: number | undefined;
  let bestValue: T | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const [id, value] of frontier) {
    const cost = costOf(value);
    if (cost < bestCost) {
      bestCost = cost;
      bestId = id;
      bestValue = value;
    }
  }
  if (bestId === undefined || bestValue === undefined) {
    return undefined;
  }
  frontier.delete(bestId);
  return [bestId, bestValue];
}

function rebuild(cameFrom: Map<number, number>, fromId: number, toId: number): number[] {
  const stars = [toId];
  let at = toId;
  while (at !== fromId) {
    const previous = cameFrom.get(at);
    if (previous === undefined) {
      return [];
    }
    stars.push(previous);
    at = previous;
  }
  return stars.reverse();
}

/**
 * The shortest chain from one star to another in which no single hop exceeds `rangePc`, or
 * `null` where the catalogue holds no such chain.
 *
 * Shortest by total distance travelled rather than by number of hops: two chains of the same
 * length are not equally good, and the one that covers less ground is the one a reader means by
 * "the way there". Neighbours are asked for as the search reaches each star rather than built
 * into a graph first, so finding one route never costs a pass over the whole catalogue.
 */
export function routeBetween(index: StarNeighbourhood, fromId: number, toId: number, rangePc: number): Route | null {
  if (fromId === toId || rangePc <= 0 || !index.point(fromId) || !index.point(toId)) {
    return null;
  }

  const best = new Map<number, number>([[fromId, 0]]);
  const cameFrom = new Map<number, number>();
  const settled = new Set<number>();
  const frontier = new Map<number, number>([[fromId, 0]]);

  while (frontier.size > 0 && settled.size < MAX_VISITED) {
    const cheapest = takeCheapest(frontier, (cost) => cost);
    if (!cheapest) {
      break;
    }
    const [starId, costHere] = cheapest;
    if (settled.has(starId)) {
      continue;
    }
    settled.add(starId);

    if (starId === toId) {
      const stars = rebuild(cameFrom, fromId, toId);
      return stars.length === 0 ? null : { stars, totalPc: costHere, longestHopPc: longestHop(index, stars) };
    }

    for (const neighbour of index.within(starId, rangePc)) {
      if (settled.has(neighbour.id)) {
        continue;
      }
      const cost = costHere + neighbour.distancePc;
      if (cost < (best.get(neighbour.id) ?? Number.POSITIVE_INFINITY)) {
        best.set(neighbour.id, cost);
        cameFrom.set(neighbour.id, starId);
        frontier.set(neighbour.id, cost);
      }
    }
  }

  return null;
}

function longestHop(index: StarNeighbourhood, stars: readonly number[]): number {
  let longest = 0;
  for (let i = 1; i < stars.length; i++) {
    const a = index.point(stars[i - 1]);
    const b = index.point(stars[i]);
    if (a && b) {
      longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
  }
  return longest;
}

/**
 * The shortest range at which any chain at all exists between two stars, or `null` if none does
 * within `ceilingPc`.
 *
 * This is what turns "no route" from a dead end into an answer: the range control can be told
 * what it would have to be raised to. It is the minimax path — the chain whose longest hop is as
 * short as possible — found by the same search as above, with the cost of reaching a star being
 * the longest hop taken to get there rather than the sum of them.
 */
export function minimumRangeBetween(index: StarNeighbourhood, fromId: number, toId: number, ceilingPc: number): number | null {
  if (fromId === toId || ceilingPc <= 0 || !index.point(fromId) || !index.point(toId)) {
    return null;
  }

  const best = new Map<number, number>([[fromId, 0]]);
  const settled = new Set<number>();
  const frontier = new Map<number, number>([[fromId, 0]]);

  while (frontier.size > 0 && settled.size < MAX_VISITED) {
    const cheapest = takeCheapest(frontier, (cost) => cost);
    if (!cheapest) {
      break;
    }
    const [starId, worstHopHere] = cheapest;
    if (settled.has(starId)) {
      continue;
    }
    settled.add(starId);

    if (starId === toId) {
      return worstHopHere;
    }

    for (const neighbour of index.within(starId, ceilingPc)) {
      if (settled.has(neighbour.id)) {
        continue;
      }
      // What this chain would need: the longest hop on it, not the distance covered by it.
      const needed = Math.max(worstHopHere, neighbour.distancePc);
      if (needed < (best.get(neighbour.id) ?? Number.POSITIVE_INFINITY)) {
        best.set(neighbour.id, needed);
        frontier.set(neighbour.id, needed);
      }
    }
  }

  return null;
}

/**
 * Every link within `rangePc` in the whole catalogue, each pair once.
 *
 * For drawing the graph, which is the only thing that wants all of it: routing asks for a
 * star's neighbours as it reaches that star and never builds this.
 */
export function collectJumpLinks(index: StarNeighbourhood, rangePc: number): JumpLink[] {
  const links: JumpLink[] = [];
  index.forEachPairWithin(rangePc, (a, b, distancePc) => {
    // The smaller id first, always. The grid hands pairs over in whatever order it walks its
    // cells, and a link that is `3-7` here and `7-3` there is two links to anything comparing.
    links.push(a.id < b.id ? { from: a.id, to: b.id, distancePc } : { from: b.id, to: a.id, distancePc });
  });
  return links;
}
