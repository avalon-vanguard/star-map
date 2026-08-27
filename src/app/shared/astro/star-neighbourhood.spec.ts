import { describe, expect, it } from 'vitest';

import { StarNeighbourhood, StarPoint } from './star-neighbourhood';

/** A line of stars one parsec apart along x, so every expected distance is an integer. */
function line(count: number): StarPoint[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, x: i, y: 0, z: 0 }));
}

function ids(found: { id: number }[]): number[] {
  return found.map((neighbour) => neighbour.id);
}

describe('StarNeighbourhood', () => {
  it('names the nearest stars in order, and never the star itself', () => {
    const index = new StarNeighbourhood(line(10));

    expect(ids(index.nearest(4, 3))).toEqual([3, 5, 2]);
  });

  it('measures the separation it found each star by', () => {
    const index = new StarNeighbourhood([
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: 3, y: 4, z: 0 }
    ]);

    expect(index.nearest(1, 1)[0].distancePc).toBeCloseTo(5);
  });

  it('reaches past its own cell for a star sitting alone in one', () => {
    // 5 pc cells: these three are in three different cells, and the nearest is 12 pc out.
    const index = new StarNeighbourhood([
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: 12, y: 0, z: 0 },
      { id: 3, x: 40, y: 0, z: 0 }
    ]);

    expect(ids(index.nearest(1, 2))).toEqual([2, 3]);
  });

  it('does not stop at the first ring that fills the list, where the next holds something closer', () => {
    // The diagonal neighbour is in the ring-1 shell but 8.7 pc away; the one straight along x is
    // in the ring-2 shell and only 6 pc away. Stopping at the first full ring would miss it.
    const index = new StarNeighbourhood([
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: 5, y: 5, z: 5 },
      { id: 3, x: 6, y: 0, z: 0 }
    ]);

    expect(ids(index.nearest(1, 1))).toEqual([3]);
  });

  it('agrees with a brute-force scan over a pseudo-random cloud', () => {
    // The property that matters: the grid is an optimisation, never a different answer.
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 100 - 50;
    const cloud: StarPoint[] = Array.from({ length: 400 }, (_, id) => ({ id, x: random(), y: random(), z: random() }));
    const index = new StarNeighbourhood(cloud);

    for (const origin of [cloud[0], cloud[199], cloud[399]]) {
      const brute = cloud
        .filter((point) => point.id !== origin.id)
        .map((point) => ({ id: point.id, distancePc: Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z) }))
        .sort((a, b) => a.distancePc - b.distancePc);

      expect(ids(index.nearest(origin.id, 5))).toEqual(ids(brute.slice(0, 5)));
      expect(ids(index.within(origin.id, 20))).toEqual(ids(brute.filter((neighbour) => neighbour.distancePc <= 20)));
    }
  });

  it('takes only the stars a filter accepts', () => {
    const index = new StarNeighbourhood(line(10));

    expect(ids(index.nearest(4, 2, (point) => point.id % 2 === 0))).toEqual([2, 6]);
  });

  it('answers nothing for a star it has never heard of', () => {
    const index = new StarNeighbourhood(line(3));

    expect(index.nearest(99, 3)).toEqual([]);
    expect(index.within(99, 10)).toEqual([]);
    expect(index.point(99)).toBeUndefined();
  });

  it('asks for nothing and gets nothing', () => {
    const index = new StarNeighbourhood(line(5));

    expect(index.nearest(0, 0)).toEqual([]);
    expect(index.within(0, 0)).toEqual([]);
  });

  it('finds every star inside a radius and none on the far side of it', () => {
    const index = new StarNeighbourhood(line(20));

    expect(ids(index.within(10, 2.5))).toEqual([9, 11, 8, 12]);
  });

  it('holds stars that share a position without losing either', () => {
    // Real catalogue rows do this: Gl 65 A and B are one binary, two entries, one position.
    const index = new StarNeighbourhood([
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: 2.63, y: 0, z: 0 },
      { id: 3, x: 2.63, y: 0, z: 0 }
    ]);

    expect(ids(index.nearest(1, 2)).sort()).toEqual([2, 3]);
  });
});
