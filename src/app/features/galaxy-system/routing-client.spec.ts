import { describe, expect, it } from 'vitest';

import { jumpLinkSegments, routeBetween } from '../../shared/astro/jump-links';
import { StarNeighbourhood } from '../../shared/astro/star-neighbourhood';
import { StarRecord } from '../../shared/models/star.model';
import { RoutingClient } from './routing-client';

const STARS: StarRecord[] = Array.from({ length: 6 }, (_, i) => ({
  id: 100 + i,
  name: `star-${i}`,
  x: i < 5 ? i : 9,
  y: 0,
  z: 0,
  magnitude: 5,
  spectralType: 'G2V',
  colorIndex: 0.6
}));
const POSITIONS = Float32Array.from(STARS.flatMap((star) => [star.x, star.y, star.z]));

// The unit tests' DOM has no Worker, which is exactly the case the client answers in place.
describe('RoutingClient without a worker', () => {
  const index = new StarNeighbourhood(STARS);

  it('has no Worker to use here, so the in-place answers are what is being tested', () => {
    expect(typeof Worker).toBe('undefined');
  });

  it('answers a route from the index it was given', async () => {
    const client = new RoutingClient(STARS, POSITIONS, index);

    await expect(client.route(100, 104, 1.5, 8)).resolves.toEqual({ route: routeBetween(index, 100, 104, 1.5), neededRangePc: null });
    client.dispose();
  });

  it('answers a refused route with the range that would open it', async () => {
    const client = new RoutingClient(STARS, POSITIONS, index);

    const answer = await client.route(100, 105, 1.5, 8);

    expect(answer.route).toBeNull();
    expect(answer.neededRangePc).toBeCloseTo(5, 1);
    client.dispose();
  });

  it('answers the graph as segments', async () => {
    const client = new RoutingClient(STARS, POSITIONS, index);

    expect(Array.from(await client.links(1.5))).toEqual(Array.from(jumpLinkSegments(index, 1.5)));
    client.dispose();
  });
});
