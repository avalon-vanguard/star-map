/**
 * Which stars are near which, over the whole catalogue.
 *
 * Two questions are asked of the same catalogue and answered here once: "what are the k nearest
 * stars to this one" (the neighbour labels shown from inside a system) and "which pairs lie
 * within n parsecs of each other" (the jump-link graph). A linear scan answers the first
 * acceptably — 68 000 distance tests, once, on entering a system — and the second not at all: a
 * graph over a few thousand nodes is a few thousand scans, and the quadratic shows.
 *
 * So both run on a uniform grid keyed by cell coordinates. The catalogue is a dense blob around
 * the Sun thinning out to 250 pc, which is exactly the distribution a uniform grid handles
 * badly in the dense middle and well everywhere else — but the queries are all small radii in
 * that same dense middle, where a cell holds a handful of stars, so the cost lands where the
 * answers are. A KD-tree would be tighter and is not yet worth its code.
 */

/** A catalogued star reduced to what proximity needs: an id and a position in parsecs. */
export interface StarPoint {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A star found near another, with the separation that found it. */
export interface Neighbour {
  readonly id: number;
  readonly distancePc: number;
}

/**
 * Cell edge in parsecs. Sized so a cell in the crowded inner catalogue holds a few dozen stars:
 * small enough that a 5 pc query touches a handful of cells, large enough that a 250 pc
 * catalogue does not allocate a map with a million keys.
 */
const DEFAULT_CELL_SIZE_PC = 5;

/** Grows the search a shell of cells at a time; the cap stops a query in empty space forever. */
const MAX_RING = 12;

function cellKey(ix: number, iy: number, iz: number): string {
  return `${ix},${iy},${iz}`;
}

export class StarNeighbourhood {
  private readonly cells = new Map<string, number[]>();
  private readonly points: readonly StarPoint[];
  private readonly indexById = new Map<number, number>();
  private readonly cellSizePc: number;

  constructor(points: readonly StarPoint[], cellSizePc: number = DEFAULT_CELL_SIZE_PC) {
    this.points = points;
    this.cellSizePc = cellSizePc > 0 ? cellSizePc : DEFAULT_CELL_SIZE_PC;

    points.forEach((point, index) => {
      this.indexById.set(point.id, index);
      const key = this.keyFor(point.x, point.y, point.z);
      const cell = this.cells.get(key);
      if (cell) {
        cell.push(index);
      } else {
        this.cells.set(key, [index]);
      }
    });
  }

  /** The star this id names, or `undefined` — the caller's id may not be in the catalogue. */
  point(id: number): StarPoint | undefined {
    const index = this.indexById.get(id);
    return index === undefined ? undefined : this.points[index];
  }

  /**
   * The `count` stars nearest to `id`, nearest first, excluding the star itself.
   *
   * Searches outward a shell of cells at a time and stops only once the shell it just finished
   * lies further away than the furthest result held — the ring that contains the kth star can
   * still be beaten by a closer star in the next ring out, since a cell's near corner is nearer
   * than its centre.
   */
  nearest(id: number, count: number, filter?: (point: StarPoint) => boolean): Neighbour[] {
    const origin = this.point(id);
    if (!origin || count <= 0) {
      return [];
    }

    const found: Neighbour[] = [];
    const [ox, oy, oz] = this.cellFor(origin.x, origin.y, origin.z);

    for (let ring = 0; ring <= MAX_RING; ring++) {
      // Everything in this ring is at least this far away, so once the results already held are
      // all closer than that, no further ring can improve them.
      if (found.length >= count && (ring - 1) * this.cellSizePc > found[found.length - 1].distancePc) {
        break;
      }

      for (const index of this.ringIndices(ox, oy, oz, ring)) {
        const candidate = this.points[index];
        if (candidate.id === id || (filter && !filter(candidate))) {
          continue;
        }
        const distancePc = Math.hypot(candidate.x - origin.x, candidate.y - origin.y, candidate.z - origin.z);
        if (found.length >= count && distancePc >= found[found.length - 1].distancePc) {
          continue;
        }
        // Insertion sort into a list that is never longer than `count`: cheaper than sorting
        // every candidate the rings turn up, of which there are far more than are kept.
        const at = found.findIndex((other) => distancePc < other.distancePc);
        found.splice(at === -1 ? found.length : at, 0, { id: candidate.id, distancePc });
        if (found.length > count) {
          found.pop();
        }
      }
    }

    return found;
  }

  /**
   * Every star within `radiusPc` of `id`, nearest first, excluding the star itself. This is what
   * a jump-link graph is built from: one call per node gives that node's edges.
   */
  within(id: number, radiusPc: number): Neighbour[] {
    const origin = this.point(id);
    if (!origin || radiusPc <= 0) {
      return [];
    }

    const found: Neighbour[] = [];
    const [ox, oy, oz] = this.cellFor(origin.x, origin.y, origin.z);
    const reach = Math.ceil(radiusPc / this.cellSizePc);

    for (let ix = ox - reach; ix <= ox + reach; ix++) {
      for (let iy = oy - reach; iy <= oy + reach; iy++) {
        for (let iz = oz - reach; iz <= oz + reach; iz++) {
          for (const index of this.cells.get(cellKey(ix, iy, iz)) ?? []) {
            const candidate = this.points[index];
            if (candidate.id === id) {
              continue;
            }
            const distancePc = Math.hypot(candidate.x - origin.x, candidate.y - origin.y, candidate.z - origin.z);
            if (distancePc <= radiusPc) {
              found.push({ id: candidate.id, distancePc });
            }
          }
        }
      }
    }

    found.sort((a, b) => a.distancePc - b.distancePc);
    return found;
  }

  /**
   * Visits every pair of stars within `radiusPc` of each other, once per pair.
   *
   * The same question `within` answers, asked of the whole catalogue at once — and a different
   * shape of answer, because asking it star by star is asking it twice per pair and paying for a
   * sorted list of each star's neighbours that the caller then throws away. Sixty-eight thousand
   * of those took eight seconds; walking the grid once takes a fraction of it.
   *
   * Each cell is paired with itself and with the half of its surrounding cells that lie after it
   * in the scan, which is what makes each pair come up exactly once.
   */
  forEachPairWithin(radiusPc: number, visit: (a: StarPoint, b: StarPoint, distancePc: number) => void): void {
    if (radiusPc <= 0) {
      return;
    }
    const reach = Math.ceil(radiusPc / this.cellSizePc);
    const radiusSq = radiusPc * radiusPc;

    for (const [key, cell] of this.cells) {
      const [ix, iy, iz] = key.split(',').map(Number);
      for (let dx = 0; dx <= reach; dx++) {
        for (let dy = dx === 0 ? 0 : -reach; dy <= reach; dy++) {
          for (let dz = dx === 0 && dy === 0 ? 0 : -reach; dz <= reach; dz++) {
            const other = dx === 0 && dy === 0 && dz === 0 ? cell : this.cells.get(cellKey(ix + dx, iy + dy, iz + dz));
            if (!other) {
              continue;
            }
            const sameCell = other === cell;
            for (let i = 0; i < cell.length; i++) {
              const a = this.points[cell[i]];
              // Within one cell, only the pairs after this one; across two, all of them — the
              // other cell is only ever visited from this side.
              for (let j = sameCell ? i + 1 : 0; j < other.length; j++) {
                const b = this.points[other[j]];
                const dxp = b.x - a.x;
                const dyp = b.y - a.y;
                const dzp = b.z - a.z;
                const distanceSq = dxp * dxp + dyp * dyp + dzp * dzp;
                if (distanceSq <= radiusSq) {
                  visit(a, b, Math.sqrt(distanceSq));
                }
              }
            }
          }
        }
      }
    }
  }

  private keyFor(x: number, y: number, z: number): string {
    const [ix, iy, iz] = this.cellFor(x, y, z);
    return cellKey(ix, iy, iz);
  }

  private cellFor(x: number, y: number, z: number): [number, number, number] {
    return [Math.floor(x / this.cellSizePc), Math.floor(y / this.cellSizePc), Math.floor(z / this.cellSizePc)];
  }

  /** Indices in the hollow shell of cells exactly `ring` cells out from the centre one. */
  private *ringIndices(ox: number, oy: number, oz: number, ring: number): Generator<number> {
    for (let ix = ox - ring; ix <= ox + ring; ix++) {
      for (let iy = oy - ring; iy <= oy + ring; iy++) {
        for (let iz = oz - ring; iz <= oz + ring; iz++) {
          // Only the shell: everything inside it was searched by a previous, smaller ring.
          const onShell = Math.abs(ix - ox) === ring || Math.abs(iy - oy) === ring || Math.abs(iz - oz) === ring;
          if (!onShell) {
            continue;
          }
          yield* this.cells.get(cellKey(ix, iy, iz)) ?? [];
        }
      }
    }
  }
}
