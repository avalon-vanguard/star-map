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
    const answer = answerRouting(index, { kind: 'links', requestId: 3, rangePc: 1.5, drawn: Uint32Array.from(POINTS.keys()) });

    expect(answer.kind).toBe('links');
    expect(answer.requestId).toBe(3);
    expect(answer.kind === 'links' && linkEnds(answer.segments)).toEqual(linkEnds(jumpLinkSegments(direct, 1.5)));
  });

  it('links only the drawn stars, including a pair exactly the range apart', () => {
    // Stars at x = 0, 1, 2 and 4 drawn; the one at 3, which would bridge 2 and 4, is not. At 1 pc
    // every link is exactly the range long, and the cells are exactly the range wide.
    const answer = answerRouting(index, { kind: 'links', requestId: 4, rangePc: 1, drawn: Uint32Array.of(0, 1, 2, 4) });

    expect(answer.kind === 'links' && linkEnds(answer.segments)).toEqual(['0-1', '1-2']);
  });
});

/** Each link as its two ends' x, lower first, in order: the pairs, whatever order they were walked in. */
function linkEnds(segments: Float32Array): string[] {
  const ends: string[] = [];
  for (let at = 0; at < segments.length; at += 6) {
    ends.push([segments[at], segments[at + 3]].sort((a, b) => a - b).join('-'));
  }
  return ends.sort();
}
