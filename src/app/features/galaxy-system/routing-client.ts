import { answerRouting, RoutingRequest, RoutingResponse } from '../../shared/astro/routing';
import { Route } from '../../shared/astro/jump-links';
import { StarNeighbourhood } from '../../shared/astro/star-neighbourhood';
import { StarRecord } from '../../shared/models/star.model';

export interface RouteAnswer {
  readonly route: Route | null;
  readonly neededRangePc: number | null;
}

/** A request dropped before it was sent, because a newer one of the same kind replaced it. */
export class SupersededRequest extends Error {
  constructor() {
    super('Superseded by a newer request');
  }
}

/** A request made and not yet answered: what was asked, and the promise whoever asked is holding. */
interface Outstanding {
  readonly request: RoutingRequest;
  /** The question without its id, so the same question asked twice can be recognised. */
  readonly question: string;
  readonly promise: Promise<RoutingResponse>;
  readonly resolve: (response: RoutingResponse) => void;
  readonly reject: (error: Error) => void;
}

function outstanding(request: RoutingRequest): Outstanding {
  let resolve!: (response: RoutingResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RoutingResponse>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { requestId, ...question } = request;
  return { request, question: JSON.stringify(question), promise, resolve, reject };
}

/** The routing worker, where this environment has one. */
function startRoutingWorker(): Worker | undefined {
  return typeof Worker === 'undefined' ? undefined : new Worker(new URL('../../shared/astro/routing.worker', import.meta.url), { type: 'module' });
}

/**
 * Asks the route questions of a worker holding its own copy of the catalogue, and hands back
 * promises.
 *
 * The worker answers one request at a time and cannot drop one it has started: a jump-link graph
 * at 8 pc is seconds of work. So requests are held here and sent one by one, and while one is out,
 * only the latest of each kind waits behind it — a newer graph replaces an older one before it is
 * ever built, and the older promise is rejected with {@link SupersededRequest}. Routes go ahead of
 * graphs, being quick and asked for by a click. The same question asked again while it is still
 * outstanding shares the answer rather than being worked out twice.
 *
 * Where there is no worker — the unit tests' DOM has none, and a worker can fail to load or crash —
 * the same answers are worked out in place, from the index the scene already holds.
 */
export class RoutingClient {
  private worker?: Worker;
  private inFlight?: Outstanding;
  private readonly waiting: Partial<Record<RoutingRequest['kind'], Outstanding>> = {};
  private nextRequestId = 0;

  constructor(
    stars: readonly StarRecord[],
    positions: Float32Array,
    private readonly localIndex: StarNeighbourhood,
    startWorker: () => Worker | undefined = startRoutingWorker
  ) {
    this.worker = startWorker();
    if (!this.worker) {
      return;
    }
    this.worker.addEventListener('message', ({ data }: MessageEvent<RoutingResponse>) => this.settle(data));
    // A worker that fails to load, or dies, answers nothing further: everything outstanding, and
    // everything asked from here on, is worked out in place instead of waiting for good.
    this.worker.addEventListener('error', () => this.abandonWorker());
    this.worker.addEventListener('messageerror', () => this.abandonWorker());
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
    this.worker = undefined;
    this.inFlight = undefined;
    delete this.waiting.route;
    delete this.waiting.links;
  }

  private ask(request: RoutingRequest): Promise<RoutingResponse> {
    if (!this.worker) {
      return new Promise((resolve) => resolve(answerRouting(this.localIndex, request)));
    }
    const asked = outstanding(request);
    const same = [this.inFlight, this.waiting[request.kind]].find((other) => other?.question === asked.question);
    if (same) {
      return same.promise;
    }
    this.waiting[request.kind]?.reject(new SupersededRequest());
    this.waiting[request.kind] = asked;
    this.sendNext();
    return asked.promise;
  }

  private sendNext(): void {
    if (this.inFlight || !this.worker) {
      return;
    }
    const next = this.waiting.route ?? this.waiting.links;
    if (!next) {
      return;
    }
    delete this.waiting[next.request.kind];
    this.inFlight = next;
    this.worker.postMessage(next.request);
  }

  private settle(response: RoutingResponse): void {
    const answered = this.inFlight;
    if (!answered || answered.request.requestId !== response.requestId) {
      return;
    }
    this.inFlight = undefined;
    if (response.kind === 'failed') {
      answered.reject(new Error(response.message));
    } else {
      answered.resolve(response);
    }
    this.sendNext();
  }

  private abandonWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
    const stranded = [this.inFlight, this.waiting.route, this.waiting.links];
    this.inFlight = undefined;
    delete this.waiting.route;
    delete this.waiting.links;
    for (const request of stranded) {
      if (!request) {
        continue;
      }
      try {
        request.resolve(answerRouting(this.localIndex, request.request));
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
