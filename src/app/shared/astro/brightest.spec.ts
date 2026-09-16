import { describe, expect, it } from 'vitest';

import { brightestWithin, brightnessOrder } from './brightest';

interface TestStar {
  id: number;
  x: number;
  y: number;
  z: number;
  magnitude: number;
}

/** A pseudo-random cloud with repeated magnitudes, so ties are exercised. */
function cloud(count: number): TestStar[] {
  let seed = 5;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: count }, (_, id) => ({
    id: id * 7,
    x: random() * 200 - 100,
    y: random() * 200 - 100,
    z: random() * 200 - 100,
    magnitude: Math.round(random() * 40) / 4
  }));
}

describe('brightnessOrder', () => {
  it('puts the brightest first and keeps catalogue order among equals', () => {
    const stars = [{ magnitude: 5 }, { magnitude: -1 }, { magnitude: 5 }, { magnitude: 2 }];

    expect(Array.from(brightnessOrder(stars))).toEqual([1, 3, 0, 2]);
  });

  it('orders nothing for an empty catalogue', () => {
    expect(brightnessOrder([])).toHaveLength(0);
  });
});

describe('brightestWithin', () => {
  // What the labels used to do on every pass: filter the whole catalogue, then sort what was left.
  function filterThenSort(stars: TestStar[], centre: { x: number; y: number; z: number }, radius: number, alwaysId: number | null): number[] {
    return stars
      .filter((star) => Math.hypot(star.x - centre.x, star.y - centre.y, star.z - centre.z) <= radius || star.id === alwaysId)
      .sort((a, b) => a.magnitude - b.magnitude)
      .map((star) => star.id);
  }

  it('yields exactly what filtering and then sorting the catalogue did, in the same order', () => {
    const stars = cloud(3000);
    const order = brightnessOrder(stars);
    const centre = { x: 12, y: -30, z: 5 };

    for (const [radius, alwaysId] of [[40, null], [15, 7 * 2999], [0, 7 * 11], [500, null]] as const) {
      const lazy = Array.from(brightestWithin(stars, order, centre, radius, alwaysId), (star) => star.id);
      expect(lazy).toEqual(filterThenSort(stars, centre, radius, alwaysId));
    }
  });

  it('includes a star lying exactly on the radius, as the scan it replaced did', () => {
    const stars = [
      { id: 1, x: 3, y: 4, z: 0, magnitude: 1 },
      { id: 2, x: 3, y: 4.001, z: 0, magnitude: 0 }
    ];

    expect(Array.from(brightestWithin(stars, brightnessOrder(stars), { x: 0, y: 0, z: 0 }, 5, null), (star) => star.id)).toEqual([1]);
  });

  it('reads no further than the caller takes', () => {
    const stars = cloud(3000);
    let read = 0;
    const counted = new Proxy(stars, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          read++;
        }
        return Reflect.get(target, key, receiver);
      }
    });

    const taken: number[] = [];
    for (const star of brightestWithin(counted, brightnessOrder(stars), { x: 0, y: 0, z: 0 }, 1000, null)) {
      taken.push(star.id);
      if (taken.length === 15) {
        break;
      }
    }

    expect(taken).toHaveLength(15);
    expect(read).toBe(15);
  });
});
