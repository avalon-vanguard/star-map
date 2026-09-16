import { answerRouting, RoutingRequest, RoutingResponse } from '../../shared/astro/routing';
import { Route } from '../../shared/astro/jump-links';
import { StarNeighbourhood } from '../../shared/astro/star-neighbourhood';
import { StarRecord } from '../../shared/models/star.model';

export interface RouteAnswer {
  readonly route: Route | null;
  readonly neededRangePc: number | null;
}

type Pending = (response: RoutingResponse) => void;

/**
 * Asks the route questions of a worker holding its own copy of the catalogue, and hands back
 * promises. Where there is no `Worker` — the unit tests' DOM has none — the same answers are
 * worked out in place, from the index the scene already holds.
 */
export class RoutingClient {
  private readonly worker?: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextRequestId = 0;

  constructor(stars: readonly StarRecord[], positions: Float32Array, private readonly localIndex: StarNeighbourhood) {
    if (typeof Worker === 'undefined') {
      return;
    }
    this.worker = new Worker(new URL('../../shared/astro/routing.worker', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', ({ data }: MessageEvent<RoutingResponse>) => {
      this.pending.get(data.requestId)?.(data);
      this.pending.delete(data.requestId);
    });
    // Copies, since the scene goes on using its own; transferred, so the copy is sent and not cloned again.
    const ids = Int32Array.from(stars, (star) => star.id);
    const copy = positions.slice();
    this.worker.postMessage({ kind: 'catalogue', ids, positions: copy }, [ids.buffer, copy.buffer]);
  }

  route(fromId: number, toId: number, rangePc: number, ceilingPc: number): Promise<RouteAnswer> {
    return this.ask({ kind: 'route', requestId: this.nextRequestId++, fromId, toId, rangePc, ceilingPc }).then((response) =>
      response.kind === 'route' ? { route: response.route, neededRangePc: response.neededRangePc } : { route: null, neededRangePc: null }
    );
  }

  /** Vertex pairs for every link within `rangePc`, three floats to an end. */
  links(rangePc: number): Promise<Float32Array> {
    return this.ask({ kind: 'links', requestId: this.nextRequestId++, rangePc }).then((response) =>
      response.kind === 'links' ? response.segments : new Float32Array(0)
    );
  }

  dispose(): void {
    this.worker?.terminate();
    this.pending.clear();
  }

  private ask(request: RoutingRequest): Promise<RoutingResponse> {
    if (!this.worker) {
      return Promise.resolve(answerRouting(this.localIndex, request));
    }
    return new Promise((resolve) => {
      this.pending.set(request.requestId, resolve);
      this.worker!.postMessage(request);
    });
  }
}
