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

/** What a search found, and whether it looked everywhere the range reaches before answering. */
export interface RouteSearch {
  readonly route: Route | null;
  /** True when the search spent its budget: "no route" then means "gave up", not "there is none". */
  readonly gaveUp: boolean;
}

/** A range that opens a route, and whether anything shorter was actually ruled out. */
export interface RangeSearch {
  /** A range a chain was found at, or `null` where none was found up to the ceiling. */
  readonly rangePc: number | null;
  /** True when every shorter range was searched to exhaustion, so this is the least that works. */
  readonly least: boolean;
}

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

/**
 * A cap on how much of the catalogue one search may walk, so a hopeless question cannot run for
 * ever. It is a budget, not a verdict: a search that spends it has proved nothing, and says so
 * through {@link RouteSearch.gaveUp}.
 *
 * Sized against the catalogue actually shipped rather than against the longest route. At 20 000 a
 * search from the Sun to HD 120147 (136 pc) in jumps of 5 pc gave up, though the chain it wanted,
 * 50 jumps, is there to be found; a star at 170 pc needed 58. Both are found at this budget. The
 * cost is paid by questions with no answer, which walk the whole of it: from the Sun to the
 * farthest star at 8 pc, 0.7 s at 20 000 against 2.1 s here, in the worker.
 */
const MAX_VISITED = 40000;

/**
 * How close to the true minimum `minimumRangeBetween` works a range out: half the Routes panel's
 * own step, which it rounds up to. Never at the cost of an answer that fails to open a route,
 * since the figure it reports is always the longest hop of a route actually found.
 */
const RANGE_RESOLUTION_PC = 0.05;

/**
 * How many of `minimumRangeBetween`'s probes may give up before it answers with what it has.
 *
 * A probe that finds a route is quick — it heads straight for the destination — while one that
 * gives up walks the whole search budget, about two seconds on the real catalogue. Those are also
 * the probes that buy the least: they cannot rule anything out. Two of them is the difference
 * between an answer of 7.96 pc in half a second and 5.76 pc in seventeen, for a star at 236 pc; it
 * lands on 5.97 pc in five.
 */
const MAX_RANGE_GIVE_UPS = 2;

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
 * The shortest chain from one star to another in which no single hop exceeds `rangePc`, or no
 * chain where the catalogue holds none within the search's budget.
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
 *
 * "No route" and "no chain" are not the same answer: a search that spends {@link MAX_VISITED}
 * reports that it gave up, so nothing downstream reads it as proof that no chain exists.
 */
export function routeBetween(index: StarNeighbourhood, fromId: number, toId: number, rangePc: number): RouteSearch {
  const origin = index.point(fromId);
  const destination = index.point(toId);
  if (fromId === toId || rangePc <= 0 || !origin || !destination) {
    return { route: null, gaveUp: false };
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
        return { route: null, gaveUp: false };
      }
      let longestHopPc = 0;
      for (let i = 1; i < stars.length; i++) {
        longestHopPc = Math.max(longestHopPc, hopTo.get(stars[i])!);
      }
      return { route: { stars, totalPc: costHere, longestHopPc }, gaveUp: false };
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

  // An empty frontier means the range reaches nothing further; a spent budget means only that the
  // search stopped looking.
  return { route: null, gaveUp: settled.size >= MAX_VISITED };
}

/**
 * A range at which a chain exists between two stars — the shortest, to within
 * `RANGE_RESOLUTION_PC`, where every shorter range could be ruled out — or `null` where no chain
 * was found up to `ceilingPc`.
 *
 * This is what turns "no route" from a dead end into an answer: the range control can be told what
 * it would have to be raised to. The figure aimed at is the minimax path, the chain whose longest
 * hop is as short as possible. It used to be searched for directly, widening from the departure in
 * order of the worst hop needed, which from the Sun meant exhausting the whole dense core before
 * anything farther could be reached: it gave up with nothing after up to a minute. Whether a chain
 * exists can only become truer as the range grows, so the range is bisected instead, each step one
 * directed `routeBetween`.
 *
 * Each step has to answer "is there a chain at this range", and a search that gives up answers
 * nothing. It is still worth carrying on from — the ranges above it are the ones left to try — but
 * the result is no longer the least range, only a range that works, and `least` says which. The
 * number of steps is bounded for the same reason: each one that gives up walks the whole budget,
 * and 11 s of them for a star at 236 pc bought two decimal places nobody reads.
 */
export function minimumRangeBetween(index: StarNeighbourhood, fromId: number, toId: number, ceilingPc: number): RangeSearch {
  const widest = routeBetween(index, fromId, toId, ceilingPc);
  if (!widest.route) {
    return { rangePc: null, least: !widest.gaveUp };
  }
  let unreachable = 0;
  let reachable = widest.route.longestHopPc;
  let giveUps = 0;
  while (reachable - unreachable > RANGE_RESOLUTION_PC && giveUps < MAX_RANGE_GIVE_UPS) {
    const range = (unreachable + reachable) / 2;
    const { route, gaveUp } = routeBetween(index, fromId, toId, range);
    if (route) {
      reachable = route.longestHopPc;
    } else {
      // A search that gave up is worth going on from — the ranges above it are the ones left to
      // try — but it is not evidence that nothing routes here, so the answer stops being the least.
      unreachable = range;
      giveUps += gaveUp ? 1 : 0;
    }
  }
  // Without a give-up the loop can only have ended by closing on the resolution, so that is the least.
  return { rangePc: reachable, least: giveUps === 0 };
}

/** How much of a graph to keep: the links nearest a point, up to a total length. */
export interface LinkBudget {
  /** Links are kept in order of how near their nearer end is to this point. */
  readonly centre: { readonly x: number; readonly y: number; readonly z: number };
  /** The most the kept links may add up to, end to end, in parsecs. */
  readonly lengthPc: number;
}

/**
 * How many distance bands a budgeted graph is split into to find where its budget runs out, so that
 * only the links in that one band are sorted rather than all of them.
 */
const DISTANCE_BANDS = 4096;

/**
 * Every link within `rangePc` between two of the stars `index` holds, each pair once, as vertex
 * pairs ready to draw: six floats a link, one end then the other. With a `budget`, only the links
 * nearest its centre, as many as fit its length.
 *
 * For drawing the graph, which is the only thing that wants all of it: routing asks for a star's
 * neighbours as it reaches that star and never builds this. Written straight into floats rather
 * than collected as link objects first, since at 8 pc the drawn stars alone have hundreds of
 * thousands of links, and the whole catalogue 3.7 million.
 */
export function jumpLinkSegments(index: StarNeighbourhood, rangePc: number, budget?: LinkBudget): Float32Array {
  let vertices = new Float32Array(6 * 4096);
  let length = 0;
  index.forEachPairWithin(rangePc, (a, b) => {
    if (length + 6 > vertices.length) {
      const grown = new Float32Array(vertices.length * 2);
      grown.set(vertices);
      vertices = grown;
    }
    vertices[length++] = a.x;
    vertices[length++] = a.y;
    vertices[length++] = a.z;
    vertices[length++] = b.x;
    vertices[length++] = b.y;
    vertices[length++] = b.z;
  });
  if (!budget) {
    // Exact length rather than a view on the grown buffer: the answer is transferred whole, and a
    // view would carry up to as much again in unused capacity with it.
    return vertices.slice(0, length);
  }

  // Each link's nearer end's distance from the centre, and its length.
  const { centre } = budget;
  const count = length / 6;
  const nearness = new Float32Array(count);
  const lengths = new Float32Array(count);
  let totalPc = 0;
  let farthest = 0;
  for (let link = 0; link < count; link++) {
    const at = link * 6;
    const ax = vertices[at] - centre.x;
    const ay = vertices[at + 1] - centre.y;
    const az = vertices[at + 2] - centre.z;
    const bx = vertices[at + 3] - centre.x;
    const by = vertices[at + 4] - centre.y;
    const bz = vertices[at + 5] - centre.z;
    nearness[link] = Math.sqrt(Math.min(ax * ax + ay * ay + az * az, bx * bx + by * by + bz * bz));
    lengths[link] = Math.hypot(bx - ax, by - ay, bz - az);
    totalPc += lengths[link];
    farthest = Math.max(farthest, nearness[link]);
  }
  if (totalPc <= budget.lengthPc) {
    return vertices.slice(0, length);
  }

  // Nearest first, without sorting them all: every link in the bands before the one where the budget
  // runs out fits, and only that band's links are sorted to see how many of them do. Sorting all
  // 730 000 links at 30 pc from the Sun to keep 4 400 doubled the time a graph took in the worker.
  const bands = new Uint16Array(count);
  const bandLengths = new Float64Array(DISTANCE_BANDS);
  const bandsPerPc = farthest > 0 ? DISTANCE_BANDS / farthest : 0;
  for (let link = 0; link < count; link++) {
    bands[link] = Math.min(DISTANCE_BANDS - 1, Math.floor(nearness[link] * bandsPerPc));
    bandLengths[bands[link]] += lengths[link];
  }
  let lastBand = 0;
  let keptPc = 0;
  while (keptPc + bandLengths[lastBand] <= budget.lengthPc) {
    keptPc += bandLengths[lastBand++];
  }
  const keptLinks: number[] = [];
  const boundary: number[] = [];
  for (let link = 0; link < count; link++) {
    const band = bands[link];
    if (band < lastBand) {
      keptLinks.push(link);
    } else if (band === lastBand) {
      boundary.push(link);
    }
  }
  boundary.sort((a, b) => nearness[a] - nearness[b] || a - b);
  for (const link of boundary) {
    if (keptPc + lengths[link] > budget.lengthPc) {
      break;
    }
    keptPc += lengths[link];
    keptLinks.push(link);
  }

  const kept = new Float32Array(keptLinks.length * 6);
  keptLinks.forEach((link, at) => kept.set(vertices.subarray(link * 6, link * 6 + 6), at * 6));
  return kept;
}
