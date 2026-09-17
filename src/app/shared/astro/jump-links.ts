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
 * A cap on how much of the catalogue one search may walk. A search that hits it has already
 * visited more stars than any real chain passes through: the longest measured, Sol to HD 2626 at
 * 236 pc in jumps of 8 pc, settles about 7 000.
 */
const MAX_VISITED = 20000;

/**
 * How close to the true minimum `minimumRangeBetween` works a range out: half the Routes panel's
 * own step, which it rounds up to. Never at the cost of an answer that fails to open a route,
 * since the figure it reports is always the longest hop of a route actually found.
 */
const RANGE_RESOLUTION_PC = 0.05;

/** A binary min-heap of star ids by priority. Duplicates are allowed; stale ones are skipped on the way out. */
class Frontier {
  private readonly ids: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, priority: number): void {
    let at = this.ids.length;
    this.ids.push(id);
    this.priorities.push(priority);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.priorities[parent] <= priority) {
        break;
      }
      this.ids[at] = this.ids[parent];
      this.priorities[at] = this.priorities[parent];
      at = parent;
    }
    this.ids[at] = id;
    this.priorities[at] = priority;
  }

  /** The id with the lowest priority, taken out. Only called while `size` is not zero. */
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastPriority = this.priorities.pop()!;
    const count = this.ids.length;
    if (count > 0) {
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        if (left >= count) {
          break;
        }
        const right = left + 1;
        const child = right < count && this.priorities[right] < this.priorities[left] ? right : left;
        if (this.priorities[child] >= lastPriority) {
          break;
        }
        this.ids[at] = this.ids[child];
        this.priorities[at] = this.priorities[child];
        at = child;
      }
      this.ids[at] = lastId;
      this.priorities[at] = lastPriority;
    }
    return top;
  }
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
 *
 * An A* search: each star waits its turn by the distance travelled to it plus the straight line
 * on to the destination, which no chain can beat, so the search heads for the destination rather
 * than widening evenly in every direction. Widening evenly is what the Gaia catalogue broke. From
 * the Sun it spent its whole budget on the 20 000 stars nearest, all inside about 40 pc, and so
 * found no route to anything farther at any range; Mirfak, 155 pc out, is 27 jumps at 8 pc.
 */
export function routeBetween(index: StarNeighbourhood, fromId: number, toId: number, rangePc: number): Route | null {
  const origin = index.point(fromId);
  const destination = index.point(toId);
  if (fromId === toId || rangePc <= 0 || !origin || !destination) {
    return null;
  }
  const straightLineOn = (x: number, y: number, z: number) => Math.hypot(destination.x - x, destination.y - y, destination.z - z);

  const travelled = new Map<number, number>([[fromId, 0]]);
  const cameFrom = new Map<number, number>();
  // Each hop's length as the range test measured it. The route's longest hop is read from these
  // rather than measured again, so a range set to it is sure to admit the route a second time,
  // which is what `minimumRangeBetween` relies on.
  const hopTo = new Map<number, number>();
  const settled = new Set<number>();
  const frontier = new Frontier();
  frontier.push(fromId, straightLineOn(origin.x, origin.y, origin.z));

  while (frontier.size > 0 && settled.size < MAX_VISITED) {
    const starId = frontier.pop();
    if (settled.has(starId)) {
      continue;
    }
    settled.add(starId);
    const costHere = travelled.get(starId)!;

    if (starId === toId) {
      const stars = rebuild(cameFrom, fromId, toId);
      if (stars.length === 0) {
        return null;
      }
      let longestHopPc = 0;
      for (let i = 1; i < stars.length; i++) {
        longestHopPc = Math.max(longestHopPc, hopTo.get(stars[i])!);
      }
      return { stars, totalPc: costHere, longestHopPc };
    }

    index.forEachWithin(starId, rangePc, (neighbour, distancePc) => {
      if (settled.has(neighbour.id)) {
        return;
      }
      const cost = costHere + distancePc;
      if (cost < (travelled.get(neighbour.id) ?? Number.POSITIVE_INFINITY)) {
        travelled.set(neighbour.id, cost);
        cameFrom.set(neighbour.id, starId);
        hopTo.set(neighbour.id, distancePc);
        frontier.push(neighbour.id, cost + straightLineOn(neighbour.x, neighbour.y, neighbour.z));
      }
    });
  }

  return null;
}

/**
 * The shortest range at which any chain at all exists between two stars, to within
 * `RANGE_RESOLUTION_PC`, or `null` if none does within `ceilingPc`.
 *
 * This is what turns "no route" from a dead end into an answer: the range control can be told
 * what it would have to be raised to. The exact figure is the minimax path, the chain whose
 * longest hop is as short as possible. It used to be searched for directly, widening from the
 * departure in order of the worst hop needed, which from the Sun meant exhausting the whole dense
 * core before anything farther could be reached: it gave up with nothing after up to a minute.
 * Whether a chain exists can only become truer as the range grows, so the range is bisected
 * instead, each step one directed `routeBetween`.
 */
export function minimumRangeBetween(index: StarNeighbourhood, fromId: number, toId: number, ceilingPc: number): number | null {
  const widest = routeBetween(index, fromId, toId, ceilingPc);
  if (!widest) {
    return null;
  }
  let unreachable = 0;
  let reachable = widest.longestHopPc;
  while (reachable - unreachable > RANGE_RESOLUTION_PC) {
    const range = (unreachable + reachable) / 2;
    const route = routeBetween(index, fromId, toId, range);
    if (route) {
      reachable = route.longestHopPc;
    } else {
      unreachable = range;
    }
  }
  return reachable;
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
