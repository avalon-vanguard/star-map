import { describe, expect, it } from 'vitest';

import { jumpLinkSegments, minimumRangeBetween, routeBetween } from './jump-links';
import { answerRouting, indexCatalogue } from './routing';
import { StarNeighbourhood } from './star-neighbourhood';

/** Stars a parsec apart along x, then a gap of 5 pc to one more. */
const POINTS = [...Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, x: i, y: 0, z: 0 })), { id: 99, x: 9, y: 0, z: 0 }];

function catalogue() {
  return {
    kind: 'catalogue' as const,
    ids: Int32Array.from(POINTS, (point) => point.id),
    positions: Float32Array.from(POINTS.flatMap((point) => [point.x, point.y, point.z]))
  };
}

describe('indexCatalogue', () => {
  it('indexes the catalogue as it was packed, id by id', () => {
    const index = indexCatalogue(catalogue());

    for (const point of POINTS) {
      expect(index.point(point.id)).toEqual(point);
    }
  });
});

describe('answerRouting', () => {
  const index = indexCatalogue(catalogue());
  const direct = new StarNeighbourhood(POINTS);

  it('answers a route the range allows, with nothing to raise it to', () => {
    const answer = answerRouting(index, { kind: 'route', requestId: 7, fromId: 10, toId: 14, rangePc: 1.5, ceilingPc: 8 });

    expect(answer).toEqual({ kind: 'route', requestId: 7, route: routeBetween(direct, 10, 14, 1.5), neededRangePc: null });
  });

  it('answers a route the range does not allow with the range that would', () => {
    const answer = answerRouting(index, { kind: 'route', requestId: 8, fromId: 10, toId: 99, rangePc: 1.5, ceilingPc: 8 });

    expect(answer).toEqual({ kind: 'route', requestId: 8, route: null, neededRangePc: minimumRangeBetween(direct, 10, 99, 8) });
    expect(answer.kind === 'route' && answer.neededRangePc).toBeCloseTo(5, 1);
  });

  it('offers nothing to raise to when even the ceiling does not reach', () => {
    const answer = answerRouting(index, { kind: 'route', requestId: 9, fromId: 10, toId: 99, rangePc: 1.5, ceilingPc: 3 });

    expect(answer).toMatchObject({ route: null, neededRangePc: null });
  });

  it('answers the graph as the segments it draws', () => {
    const answer = answerRouting(index, { kind: 'links', requestId: 3, rangePc: 1.5 });

    expect(answer.kind).toBe('links');
    expect(answer.requestId).toBe(3);
    expect(answer.kind === 'links' && Array.from(answer.segments)).toEqual(Array.from(jumpLinkSegments(direct, 1.5)));
  });
});
