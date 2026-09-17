import { describe, expect, it } from 'vitest';

import { jumpLinkSegments, minimumRangeBetween, routeBetween } from './jump-links';
import { StarNeighbourhood, StarPoint } from './star-neighbourhood';

/** Stars a parsec apart along x, so a chain's length is the number of hops it takes. */
function chain(count: number): StarNeighbourhood {
  return new StarNeighbourhood(Array.from({ length: count }, (_, i) => ({ id: i, x: i, y: 0, z: 0 })));
}

function index(points: StarPoint[]): StarNeighbourhood {
  return new StarNeighbourhood(points);
}

describe('routeBetween', () => {
  it('walks the chain a hop at a time when that is all the range allows', () => {
    const route = routeBetween(chain(5), 0, 4, 1.5);

    expect(route?.stars).toEqual([0, 1, 2, 3, 4]);
    expect(route?.totalPc).toBeCloseTo(4);
    expect(route?.longestHopPc).toBeCloseTo(1);
  });

  it('goes straight there when the range reaches, however many stars lie between', () => {
    // The direct crossing is never longer than a chain through anything — Euclid says so — so a
    // range that covers it makes it the answer, and the stars in between are just scenery.
    const route = routeBetween(chain(5), 0, 4, 5);

    expect(route?.stars).toEqual([0, 4]);
    expect(route?.totalPc).toBeCloseTo(4);
  });

  it('picks the shorter of two ways round when neither is a straight line', () => {
    // 0 to 3 is 10 pc, out of a 6 pc range. Two ways round, both inside it: through 1, barely
    // off the line, or through 2, well off it. Shorter is what "the way there" means.
    const route = routeBetween(
      index([
        { id: 0, x: 0, y: 0, z: 0 },
        { id: 1, x: 5, y: 0.5, z: 0 },
        { id: 2, x: 5, y: 3, z: 0 },
        { id: 3, x: 10, y: 0, z: 0 }
      ]),
      0,
      3,
      6
    );

    expect(route?.stars).toEqual([0, 1, 3]);
    expect(route?.totalPc).toBeCloseTo(10.05, 1);
  });

  it('finds nothing across a gap wider than the range', () => {
    const split = index([
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 20, y: 0, z: 0 }
    ]);

    expect(routeBetween(split, 0, 2, 5)).toBeNull();
  });

  it('answers nothing for a star that is not there, or for going nowhere', () => {
    const line = chain(3);

    expect(routeBetween(line, 0, 0, 2)).toBeNull();
    expect(routeBetween(line, 0, 99, 2)).toBeNull();
    expect(routeBetween(line, 0, 2, 0)).toBeNull();
  });

  it('reports the longest hop, which is what the range has to cover', () => {
    const route = routeBetween(
      index([
        { id: 0, x: 0, y: 0, z: 0 },
        { id: 1, x: 1, y: 0, z: 0 },
        { id: 2, x: 5, y: 0, z: 0 }
      ]),
      0,
      2,
      4
    );

    expect(route?.longestHopPc).toBeCloseTo(4);
  });

  it('heads for the destination rather than exhausting a dense knot around the departure', () => {
    // The Gaia catalogue in miniature: a crowd around the departure, larger than the search's
    // budget, with the only way on a thin chain leading out of it. A search widening evenly from
    // the departure spends the budget on the crowd and never reaches the chain's far end.
    const route = routeBetween(knotAndChain(), 0, CHAIN_END, 1.5);

    expect(route).not.toBeNull();
    expect(route!.stars[route!.stars.length - 1]).toBe(CHAIN_END);
    expect(route!.longestHopPc).toBeLessThanOrEqual(1.5);
  });
});

/**
 * 21 000 stars scattered through the 30 pc cube around the origin, about ten times the density
 * around the real Sun and more than a search's budget, with a chain a parsec a hop running along
 * x from the origin out through the crowd and on to 75 pc.
 */
const CHAIN_END = 75;
function knotAndChain(): StarNeighbourhood {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 30 - 15;
  const knot: StarPoint[] = Array.from({ length: 21000 }, (_, i) => ({ id: 1000 + i, x: random(), y: random(), z: random() }));
  const chainOut: StarPoint[] = Array.from({ length: CHAIN_END }, (_, i) => ({ id: i + 1, x: i + 1, y: 0, z: 0 }));
  return index([{ id: 0, x: 0, y: 0, z: 0 }, ...knot, ...chainOut]);
}

describe('minimumRangeBetween', () => {
  it('works out the range past a dense knot around the departure', () => {
    // Past the crowd the chain's hops of a parsec are the only way on, so a parsec is the
    // answer, to the half-step the panel rounds up to.
    expect(minimumRangeBetween(knotAndChain(), 0, CHAIN_END, 8)).toBeCloseTo(1, 1);
  });

  it('names the shortest range that opens a way through', () => {
    // Hops of 1 and 4: no range under 4 connects them, and 4 exactly does.
    const stepped = index([
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 5, y: 0, z: 0 }
    ]);

    expect(minimumRangeBetween(stepped, 0, 2, 50)).toBeCloseTo(4);
    expect(routeBetween(stepped, 0, 2, 4)).not.toBeNull();
    expect(routeBetween(stepped, 0, 2, 3.99)).toBeNull();
  });

  it('prefers a longer way whose worst hop is shorter, since that is what the range pays for', () => {
    // Direct: one hop of 10. Round: three hops of at most 4. The range only has to cover 4.
    const both = index([
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 0, y: 4, z: 0 },
      { id: 2, x: 6, y: 7, z: 0 },
      { id: 3, x: 10, y: 0, z: 0 }
    ]);

    const needed = minimumRangeBetween(both, 0, 3, 50);

    expect(needed).toBeLessThan(10);
    expect(routeBetween(both, 0, 3, needed!)).not.toBeNull();
  });

  it('finds nothing when even the ceiling does not reach', () => {
    const split = index([
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 100, y: 0, z: 0 }
    ]);

    expect(minimumRangeBetween(split, 0, 1, 50)).toBeNull();
  });
});

/**
 * The links a segment buffer draws, as unordered pairs of star ids, read back from where each end
 * sits. Positions are compared as the float32 the buffer holds.
 */
function linksDrawn(segments: Float32Array, points: readonly StarPoint[]): string[] {
  const idAt = new Map(points.map((point) => [[point.x, point.y, point.z].map(Math.fround).join(), point.id]));
  const links: string[] = [];
  for (let at = 0; at < segments.length; at += 6) {
    const a = idAt.get(Array.from(segments.subarray(at, at + 3)).join())!;
    const b = idAt.get(Array.from(segments.subarray(at + 3, at + 6)).join())!;
    links.push(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  return links;
}

/** Stars a parsec apart along x, as points, for reading a segment buffer back. */
function chainPoints(count: number): StarPoint[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, x: i, y: 0, z: 0 }));
}

describe('jumpLinkSegments', () => {
  it('draws each pair once, not once from either end', () => {
    const segments = jumpLinkSegments(chain(4), 1.5);

    expect(linksDrawn(segments, chainPoints(4)).sort()).toEqual(['0-1', '1-2', '2-3']);
  });

  it('puts both ends of every link where its stars are', () => {
    const segments = jumpLinkSegments(chain(3), 2.5);

    expect(segments).toHaveLength(3 * 6);
    expect(linksDrawn(segments, chainPoints(3)).sort()).toEqual(['0-1', '0-2', '1-2']);
  });

  it('draws nothing at no range', () => {
    expect(jumpLinkSegments(chain(4), 0)).toHaveLength(0);
  });

  it('keeps the links nearest the centre first, for as much length as the budget holds', () => {
    // A parsec apart from 0 to 20, the centre at 10.3. By nearer end: 9-10 and 10-11 (0.3 away),
    // then 11-12 (0.7), then 8-9 (1.3). Three parsecs of them fit in 3.5; a fourth would not.
    const budget = { centre: { x: 10.3, y: 0, z: 0 }, lengthPc: 3.5 };

    const segments = jumpLinkSegments(chain(21), 1.5, budget);

    expect(linksDrawn(segments, chainPoints(21)).sort()).toEqual(['10-11', '11-12', '9-10']);
    expect(segments.buffer.byteLength).toBe(segments.byteLength);
  });

  it('counts the budget in parsecs of link, not in links', () => {
    // Stars at 0, 1 and 3: a 2 pc link nearest the centre, then a 1 pc one. Two and a half parsecs
    // hold the first and not both, though two links would fit a count of two and a half.
    const points: StarPoint[] = [{ id: 0, x: 0, y: 0, z: 0 }, { id: 1, x: 1, y: 0, z: 0 }, { id: 2, x: 3, y: 0, z: 0 }];

    const segments = jumpLinkSegments(index(points), 2.5, { centre: { x: 3, y: 0, z: 0 }, lengthPc: 2.5 });

    expect(linksDrawn(segments, points)).toEqual(['1-2']);
  });

  it('grows past its first buffer without losing a link', () => {
    // 5 000 stars a tenth of a parsec apart, ten neighbours each way in range: some 50 000 links, far past
    // the 4 096 the buffer starts with, so it has to grow several times.
    const count = 5000;
    const line = new StarNeighbourhood(Array.from({ length: count }, (_, i) => ({ id: i, x: i / 10, y: 0, z: 0 })));
    // 1.05 rather than 1: the tenth neighbour sits at 1.0, which float steps of a tenth put either side of it.
    const segments = jumpLinkSegments(line, 1.05);

    let expected = 0;
    for (let i = 0; i < count; i++) {
      expected += Math.min(10, count - 1 - i);
    }
    expect(segments.length / 6).toBe(expected);
    expect(segments.buffer.byteLength).toBe(segments.byteLength);
  });

  it('agrees with every route it makes possible', () => {
    // The graph drawn and the graph walked have to be the same graph, or the map shows a way
    // the route cannot take.
    let seed = 11;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 30 - 15;
    const points: StarPoint[] = Array.from({ length: 120 }, (_, id) => ({ id, x: random(), y: random(), z: random() }));
    const cloud = index(points);
    // 9 rather than 6: at 6 this cloud falls into pieces and 0 never reaches 119, which an
    // earlier version of this test hid by only checking the route it happened to find.
    const range = 9;

    const drawn = new Set(linksDrawn(jumpLinkSegments(cloud, range), points));

    const route = routeBetween(cloud, 0, 119, range);
    // Asserted, not guarded: a skipped body would let the two disagree unnoticed.
    expect(route).not.toBeNull();
    expect(route!.stars.length).toBeGreaterThan(2);
    for (let i = 1; i < route!.stars.length; i++) {
      const [a, b] = [route!.stars[i - 1], route!.stars[i]].sort((x, y) => x - y);
      expect(drawn.has(`${a}-${b}`)).toBe(true);
    }
    expect(drawn.size).toBeGreaterThan(0);
  });
});
