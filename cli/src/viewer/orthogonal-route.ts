import type { Box, Point } from './alignment-graph.js';

const PAD = 8;
const CLEARANCE = 12;
export const routeSegments = (points: Point[]) => points.slice(1).map((b, index) => ({ a: points[index], b }));
const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));

export function simplifyRoute(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    while (result.length >= 2) {
      const [a, b] = result.slice(-2);
      if (!((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) break;
      // Preserve reversals so the authoritative validator can reject them.
      if ((b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) < 0) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

// A visibility grid introduces bends that local track shifts cannot. Other routes may cross
// perpendicularly, but parallel runs keep their clearance. Length, bends, and crossings all cost.
export function searchOrthogonalRoute(start: Point, end: Point, obstacles: Box[], routes: Point[][], terminals?: [Point, Point], budget = { remaining: 80_000 }): Point[] | undefined {
  const segments = routes.flatMap(routeSegments);
  const coordinates = (axis: 'x' | 'y') => {
    const span = axis === 'x' ? 'width' : 'height';
    const values = [start[axis], end[axis], ...obstacles.flatMap(box => [box[axis] - PAD, box[axis] + box[span] + PAD]),
      ...segments.flatMap(({ a, b }) => a[axis] === b[axis] ? [a[axis] - CLEARANCE, a[axis], a[axis] + CLEARANCE] : [a[axis], b[axis]])];
    return [...new Set([...values, Math.min(...values) - 32, Math.max(...values) + 32])].sort((a, b) => a - b);
  };
  const xs = coordinates('x');
  const ys = coordinates('y');
  const width = xs.length;
  const point = (id: number): Point => ({ x: xs[id % width], y: ys[Math.floor(id / width)] });
  const vertex = (p: Point) => ys.indexOf(p.y) * width + xs.indexOf(p.x);
  const goal = vertex(end);
  const origin = vertex(start);
  const count = width * ys.length;
  if (count > 100_000) return undefined;
  const decode = (state: number) => ({ id: Math.floor(state / count / 3), direction: Math.floor(state / count) % 3, runStart: state % count });
  const costs = new Map<number, number>();
  const parents = new Map<number, number>();
  const heap: { state: number; cost: number; priority: number }[] = [];
  const push = (entry: typeof heap[number]) => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index) {
      const parent = (index - 1) >> 1;
      if (heap[parent].priority <= entry.priority) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = entry;
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].priority < heap[child].priority) child += 1;
        if (heap[child].priority >= last.priority) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    return first;
  };
  const segmentCosts = new Map<string, number>();
  const segmentCost = (from: number, to: number) => {
    const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
    if (segmentCosts.has(key)) return segmentCosts.get(key)!;
    const a = point(from);
    const b = point(to);
    let cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (obstacles.some(box => Math.min(a.x, b.x) < box.x + box.width + PAD && Math.max(a.x, b.x) > box.x - PAD
      && Math.min(a.y, b.y) < box.y + box.height + PAD && Math.max(a.y, b.y) > box.y - PAD)) cost = Infinity;
    const axis = a.x === b.x ? 'y' : 'x';
    const across = axis === 'x' ? 'y' : 'x';
    if (Number.isFinite(cost)) for (const other of segments) {
      const parallel = other.a[across] === other.b[across];
      if (!parallel && other.a[axis] >= Math.min(a[axis], b[axis]) && other.a[axis] <= Math.max(a[axis], b[axis])
        && a[across] > Math.min(other.a[across], other.b[across]) && a[across] < Math.max(other.a[across], other.b[across])) cost += 120;
    }
    segmentCosts.set(key, cost);
    return cost;
  };
  const nearby = new Map<string, typeof segments>();
  const parallelClear = (runStart: number, next: number) => {
    let a = point(runStart);
    let b = point(next);
    const axis = a.x === b.x ? 'y' : 'x';
    const across = axis === 'x' ? 'y' : 'x';
    // Joining the searched path to a port stub must not turn two short pieces into
    // one forbidden long parallel run.
    if (runStart === origin && terminals?.[0][across] === a[across]) a = terminals[0];
    if (next === goal && terminals?.[1][across] === b[across]) b = terminals[1];
    const key = `${across}:${a[across]}`;
    let parallel = nearby.get(key);
    if (!parallel) {
      parallel = segments.filter(other => other.a[across] === other.b[across] && Math.abs(a[across] - other.a[across]) < CLEARANCE - 1e-6);
      nearby.set(key, parallel);
    }
    return parallel.every(other => overlap(a[axis], b[axis], other.a[axis], other.b[axis]) <= CLEARANCE);
  };
  const initial = origin * 3 * count + origin;
  costs.set(initial, 0);
  push({ state: initial, cost: 0, priority: 0 });
  // Bound the optional fallback's memory; exhaustion remains an explicit layout failure.
  while (heap.length && costs.size <= 80_000 && budget.remaining > 0) {
    budget.remaining -= 1;
    const { state, cost } = pop();
    if (cost !== costs.get(state)) continue;
    const { id, direction: priorDirection, runStart } = decode(state);
    if (id === goal) {
      const points: Point[] = [];
      for (let current: number | undefined = state; current !== undefined; current = parents.get(current)) points.push(point(decode(current).id));
      return simplifyRoute(points.reverse());
    }
    const x = id % width;
    const y = Math.floor(id / width);
    const neighbors = [...(x ? [id - 1] : []), ...(x + 1 < width ? [id + 1] : []), ...(y ? [id - width] : []), ...(y + 1 < ys.length ? [id + width] : [])];
    for (const next of neighbors) {
      const direction = Math.floor(next / width) === y ? 1 : 2;
      const nextRunStart = priorDirection === direction ? runStart : id;
      if (!parallelClear(nextRunStart, next)) continue;
      const nextState = (next * 3 + direction) * count + nextRunStart;
      const nextCost = cost + segmentCost(id, next) + (priorDirection && priorDirection !== direction ? 40 : 0);
      if (!Number.isFinite(nextCost) || nextCost >= (costs.get(nextState) ?? Infinity)) continue;
      costs.set(nextState, nextCost);
      parents.set(nextState, state);
      const p = point(next);
      push({ state: nextState, cost: nextCost, priority: nextCost + 1.15 * (Math.abs(p.x - end.x) + Math.abs(p.y - end.y)) });
    }
  }
  return undefined;
}
