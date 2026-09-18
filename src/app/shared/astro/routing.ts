/**
 * The route questions the map asks of the whole catalogue, as messages: what a worker is sent,
 * what it sends back, and the one function that turns the first into the second.
 *
 * Kept apart from the worker itself so it runs the same on either side of the thread boundary.
 * The scene asks through `RoutingClient`, which hands these to a Web Worker where one exists and
 * answers them in place where one does not.
 */

import { jumpLinkSegments, LinkBudget, minimumRangeBetween, Route, routeBetween } from './jump-links';
import { StarNeighbourhood } from './star-neighbourhood';

/** The catalogue, sent once: ids, and positions packed three to a star in the same order. */
export interface RoutingCatalogue {
  readonly kind: 'catalogue';
  readonly ids: Int32Array;
  readonly positions: Float32Array;
}

export type RoutingRequest =
  | { readonly kind: 'route'; readonly requestId: number; readonly fromId: number; readonly toId: number; readonly rangePc: number; readonly ceilingPc: number }
  /**
   * `drawn` is the stars the map is drawing, as positions in the catalogue that was sent: only they
   * are linked. `budget`, where given, keeps only the links nearest the view that fit its length.
   */
  | { readonly kind: 'links'; readonly requestId: number; readonly rangePc: number; readonly drawn: Uint32Array; readonly budget?: LinkBudget };

export type RoutingResponse =
  /**
   * Two searches, and two things they can fail to prove, kept apart because they are printed as
   * different sentences. `gaveUp` is about the range that was asked for: true when that search
   * spent its budget rather than looking everywhere the range reaches. `least` is about the search
   * for a range that would work: true when it looked everywhere up to the ceiling, so `null` there
   * means no chain exists rather than none was found.
   */
  | {
      readonly kind: 'route';
      readonly requestId: number;
      readonly route: Route | null;
      readonly neededRangePc: number | null;
      readonly gaveUp: boolean;
      readonly least: boolean;
    }
  | { readonly kind: 'links'; readonly requestId: number; readonly segments: Float32Array }
  /** The question threw in the worker. Sent back so the request settles instead of waiting for good. */
  | { readonly kind: 'failed'; readonly requestId: number; readonly message: string };

/** A spatial index over a catalogue sent as a {@link RoutingCatalogue}. */
export function indexCatalogue({ ids, positions }: RoutingCatalogue): StarNeighbourhood {
  return new StarNeighbourhood(Array.from(ids, (id, i) => ({ id, x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] })));
}

/**
 * Answers one request. A route that cannot be made comes back with the range that would make one,
 * searched no wider than `ceilingPc`, so a refusal is usually also an offer — unless the searches
 * gave up, which is reported rather than passed off as "there is no route".
 */
export function answerRouting(index: StarNeighbourhood, request: RoutingRequest): RoutingResponse {
  if (request.kind === 'links') {
    // An index of its own over the drawn stars, in cells as wide as the range, so each cell is
    // paired with its immediate neighbours only: 14 cells a cell at 8 pc rather than 63.
    const drawn = new StarNeighbourhood(Array.from(request.drawn, (at) => index.pointAt(at)), request.rangePc);
    return { kind: 'links', requestId: request.requestId, segments: jumpLinkSegments(drawn, request.rangePc, request.budget) };
  }
  const { route, gaveUp } = routeBetween(index, request.fromId, request.toId, request.rangePc);
  // At the ceiling the question has just been asked: the range search would repeat it, identically
  // and at the same cost, before bisecting below it.
  if (route || request.rangePc >= request.ceilingPc) {
    // Asked at the ceiling, the one search answers both questions.
    return { kind: 'route', requestId: request.requestId, route, neededRangePc: null, gaveUp: !route && gaveUp, least: !gaveUp };
  }
  const needed = minimumRangeBetween(index, request.fromId, request.toId, request.ceilingPc);
  return { kind: 'route', requestId: request.requestId, route: null, neededRangePc: needed.rangePc, gaveUp, least: needed.least };
}
