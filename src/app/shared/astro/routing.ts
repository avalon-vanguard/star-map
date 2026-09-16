/**
 * The route questions the map asks of the whole catalogue, as messages: what a worker is sent,
 * what it sends back, and the one function that turns the first into the second.
 *
 * Kept apart from the worker itself so it runs the same on either side of the thread boundary.
 * The scene asks through `RoutingClient`, which hands these to a Web Worker where one exists and
 * answers them in place where one does not.
 */

import { jumpLinkSegments, minimumRangeBetween, Route, routeBetween } from './jump-links';
import { StarNeighbourhood } from './star-neighbourhood';

/** The catalogue, sent once: ids, and positions packed three to a star in the same order. */
export interface RoutingCatalogue {
  readonly kind: 'catalogue';
  readonly ids: Int32Array;
  readonly positions: Float32Array;
}

export type RoutingRequest =
  | { readonly kind: 'route'; readonly requestId: number; readonly fromId: number; readonly toId: number; readonly rangePc: number; readonly ceilingPc: number }
  | { readonly kind: 'links'; readonly requestId: number; readonly rangePc: number };

export type RoutingResponse =
  | { readonly kind: 'route'; readonly requestId: number; readonly route: Route | null; readonly neededRangePc: number | null }
  | { readonly kind: 'links'; readonly requestId: number; readonly segments: Float32Array }
  /** The question threw in the worker. Sent back so the request settles instead of waiting for good. */
  | { readonly kind: 'failed'; readonly requestId: number; readonly message: string };

/** A spatial index over a catalogue sent as a {@link RoutingCatalogue}. */
export function indexCatalogue({ ids, positions }: RoutingCatalogue): StarNeighbourhood {
  return new StarNeighbourhood(Array.from(ids, (id, i) => ({ id, x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] })));
}

/**
 * Answers one request. A route that cannot be made comes back with the range that would make
 * one, searched no wider than `ceilingPc`, so a refusal is always also an offer.
 */
export function answerRouting(index: StarNeighbourhood, request: RoutingRequest): RoutingResponse {
  if (request.kind === 'links') {
    return { kind: 'links', requestId: request.requestId, segments: jumpLinkSegments(index, request.rangePc) };
  }
  const route = routeBetween(index, request.fromId, request.toId, request.rangePc);
  return {
    kind: 'route',
    requestId: request.requestId,
    route,
    neededRangePc: route ? null : minimumRangeBetween(index, request.fromId, request.toId, request.ceilingPc)
  };
}
