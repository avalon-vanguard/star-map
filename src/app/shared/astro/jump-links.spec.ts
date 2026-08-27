import { describe, expect, it } from 'vitest';

import { collectJumpLinks, minimumRangeBetween, routeBetween } from './jump-links';
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
});

describe('minimumRangeBetween', () => {
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

describe('collectJumpLinks', () => {
  it('reports each pair once, not once from either end', () => {
    const links = collectJumpLinks(chain(4), 1.5);

    expect(links.map((link) => [link.from, link.to])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3]
    ]);
  });

  it('measures every link it reports', () => {
    const links = collectJumpLinks(chain(3), 2.5);

    expect(links.find((link) => link.from === 0 && link.to === 2)?.distancePc).toBeCloseTo(2);
  });

  it('draws nothing at no range', () => {
    expect(collectJumpLinks(chain(4), 0)).toEqual([]);
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

    const links = collectJumpLinks(cloud, range);
    const drawn = new Set(links.map((link) => `${link.from}-${link.to}`));

    const route = routeBetween(cloud, 0, 119, range);
    // Asserted, not guarded: a skipped body would let the two disagree unnoticed.
    expect(route).not.toBeNull();
    expect(route!.stars.length).toBeGreaterThan(2);
    for (let i = 1; i < route!.stars.length; i++) {
      const [a, b] = [route!.stars[i - 1], route!.stars[i]].sort((x, y) => x - y);
      expect(drawn.has(`${a}-${b}`)).toBe(true);
    }
    expect(links.length).toBeGreaterThan(0);
  });
});
