import { describe, expect, it } from 'vitest';

import { jumpLinkSegments, routeBetween } from '../../shared/astro/jump-links';
import { RoutingRequest, RoutingResponse } from '../../shared/astro/routing';
import { StarNeighbourhood } from '../../shared/astro/star-neighbourhood';
import { StarRecord } from '../../shared/models/star.model';
import { RoutingClient, SupersededRequest } from './routing-client';

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
const index = new StarNeighbourhood(STARS);

/** Flushes settled promises and their handlers. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A worker that records what it is sent and answers only when told to. */
class FakeWorker {
  readonly sent: Array<RoutingRequest | { kind: 'catalogue' }> = [];
  private readonly listeners: Record<string, Array<(event: { data?: unknown }) => void>> = {};
  terminated = false;

  postMessage(message: RoutingRequest | { kind: 'catalogue' }): void {
    this.sent.push(message);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** The requests sent so far, catalogue aside. */
  get requests(): RoutingRequest[] {
    return this.sent.filter((message): message is RoutingRequest => message.kind !== 'catalogue');
  }

  answer(response: RoutingResponse): void {
    for (const listener of this.listeners['message'] ?? []) listener({ data: response });
  }

  fail(): void {
    for (const listener of this.listeners['error'] ?? []) listener({});
  }
}

function clientWithFake(): { client: RoutingClient; worker: FakeWorker } {
  const worker = new FakeWorker();
  const client = new RoutingClient(STARS, POSITIONS, index, () => worker as unknown as Worker);
  return { client, worker };
}

// The unit tests' DOM has no Worker, which is exactly the case the client answers in place.
describe('RoutingClient without a worker', () => {
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

describe('RoutingClient with a worker', () => {
  it('sends the catalogue first, then one request at a time', () => {
    const { client, worker } = clientWithFake();

    void client.links(8);
    void client.links(3);

    expect(worker.sent[0].kind).toBe('catalogue');
    expect(worker.requests).toHaveLength(1);
    client.dispose();
  });

  // A graph at 8 pc is seconds of work the worker cannot drop once started. Every pause on the
  // range slider used to queue another, and a route asked for after them waited behind them all.
  it('replaces a waiting graph with the newer one before it is ever built, and sends a route ahead of it', async () => {
    const { client, worker } = clientWithFake();
    const first = client.links(5);
    const superseded = client.links(6).catch((error: unknown) => error);
    const latest = client.links(8);
    const route = client.route(100, 104, 1.5, 8);

    const building = worker.requests[0];
    worker.answer({ kind: 'links', requestId: building.requestId, segments: new Float32Array(6) });
    await flush();

    expect(await superseded).toBeInstanceOf(SupersededRequest);
    expect(worker.requests.map((request) => request.kind)).toEqual(['links', 'route']);
    await expect(first).resolves.toHaveLength(6);

    const routeRequest = worker.requests[1];
    worker.answer({ kind: 'route', requestId: routeRequest.requestId, route: null, neededRangePc: 4 });
    await expect(route).resolves.toEqual({ route: null, neededRangePc: 4 });
    await flush();

    expect(worker.requests.map((request) => (request.kind === 'links' ? request.rangePc : request.kind))).toEqual([5, 'route', 8]);
    const lastGraph = worker.requests[2];
    worker.answer({ kind: 'links', requestId: lastGraph.requestId, segments: new Float32Array(12) });
    await expect(latest).resolves.toHaveLength(12);
    client.dispose();
  });

  it('shares the answer to a question already on its way rather than asking it twice', async () => {
    const { client, worker } = clientWithFake();
    const once = client.links(7.5);
    const again = client.links(7.5);

    expect(worker.requests).toHaveLength(1);
    worker.answer({ kind: 'links', requestId: worker.requests[0].requestId, segments: new Float32Array(6) });

    expect(await again).toBe(await once);
    expect(worker.requests).toHaveLength(1);
    client.dispose();
  });

  it('rejects a request the worker failed on, and goes on to the next', async () => {
    const { client, worker } = clientWithFake();
    const failing = client.route(100, 104, 1.5, 8).catch((error: unknown) => error);
    const next = client.links(3);

    worker.answer({ kind: 'failed', requestId: worker.requests[0].requestId, message: 'out of memory' });

    expect(((await failing) as Error).message).toBe('out of memory');
    await flush();
    expect(worker.requests.map((request) => request.kind)).toEqual(['route', 'links']);
    worker.answer({ kind: 'links', requestId: worker.requests[1].requestId, segments: new Float32Array(0) });
    await expect(next).resolves.toHaveLength(0);
    client.dispose();
  });

  it('answers in place what a worker that failed to load left outstanding, and everything after', async () => {
    const { client, worker } = clientWithFake();
    const route = client.route(100, 104, 1.5, 8);
    const graph = client.links(1.5);

    worker.fail();

    await expect(route).resolves.toEqual({ route: routeBetween(index, 100, 104, 1.5), neededRangePc: null });
    expect(Array.from(await graph)).toEqual(Array.from(jumpLinkSegments(index, 1.5)));
    await expect(client.route(100, 105, 1.5, 8)).resolves.toMatchObject({ route: null });
    expect(worker.terminated).toBe(true);
    client.dispose();
  });
});
