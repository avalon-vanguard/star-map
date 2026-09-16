/// <reference lib="webworker" />

import { answerRouting, indexCatalogue, RoutingCatalogue, RoutingRequest } from './routing';
import { StarNeighbourhood } from './star-neighbourhood';

/**
 * Walks routes and builds the jump-link graph off the main thread. A search to a star 236 pc
 * away, and the range it would need when there is none, can take seconds; a graph at 8 pc is
 * 3.7 million links. On the page's own thread either stops the map for as long as it runs.
 */
let index: StarNeighbourhood | undefined;

addEventListener('message', ({ data }: MessageEvent<RoutingCatalogue | RoutingRequest>) => {
  if (data.kind === 'catalogue') {
    index = indexCatalogue(data);
    return;
  }
  // The catalogue is always the first message, and a worker's messages arrive in order.
  const response = answerRouting(index!, data);
  postMessage(response, response.kind === 'links' ? [response.segments.buffer] : []);
});
