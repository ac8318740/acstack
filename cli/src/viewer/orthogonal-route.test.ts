import { describe, expect, it } from 'vitest';
import { searchOrthogonalRoute, routeSegments, simplifyRoute } from './orthogonal-route.js';
import type { Box, Point } from './alignment-graph.js';

function expectSafe(points: Point[] | undefined, obstacles: Box[]) {
  expect(points).toBeDefined();
  for (const { a, b } of routeSegments(points!)) {
    expect(a.x === b.x || a.y === b.y).toBe(true);
    expect(a).not.toEqual(b);
    for (const box of obstacles) {
      expect(Math.min(a.x, b.x) < box.x + box.width + 8 && Math.max(a.x, b.x) > box.x - 8
        && Math.min(a.y, b.y) < box.y + box.height + 8 && Math.max(a.y, b.y) > box.y - 8).toBe(false);
    }
  }
}

describe('orthogonal visibility search', () => {
  it('adds multiple bends around staggered obstacles instead of shifting one existing track', () => {
    const obstacles = [
      { x: 60, y: -140, width: 60, height: 180 },
      { x: 180, y: -40, width: 60, height: 180 },
      { x: -20, y: -160, width: 340, height: 20 },
      { x: -20, y: 140, width: 340, height: 20 },
    ];
    const points = searchOrthogonalRoute({ x: 0, y: 0 }, { x: 300, y: 0 }, obstacles, []);
    expectSafe(points, obstacles);
    expect(points!.length).toBeGreaterThanOrEqual(6);
    expect(points![0]).toEqual({ x: 0, y: 0 });
    expect(points!.at(-1)).toEqual({ x: 300, y: 0 });
  });

  it('keeps twelve-pixel parallel clearance while permitting a perpendicular crossing', () => {
    const other = [{ x: -40, y: 0 }, { x: 160, y: 0 }];
    const points = searchOrthogonalRoute({ x: 0, y: -40 }, { x: 100, y: 40 }, [], [other]);
    expectSafe(points, []);
    for (const { a, b } of routeSegments(points!)) if (a.y === b.y) expect(Math.abs(a.y)).toBeGreaterThanOrEqual(12);
    expect(routeSegments(points!).some(({ a, b }) => a.x === b.x && a.y * b.y < 0)).toBe(true);
  });

  it('includes the fixed terminal stub in parallel-clearance checks', () => {
    const end = { x: 110, y: 6 };
    const points = searchOrthogonalRoute({ x: 0, y: 50 }, { x: 100, y: 6 }, [], [[{ x: -20, y: 0 }, { x: 200, y: 0 }]], [{ x: 0, y: 50 }, end]);
    expect(points).toBeDefined();
    for (const { a, b } of routeSegments(simplifyRoute([...points!, end]))) {
      if (a.y === b.y && Math.abs(a.y) < 12) expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(12);
    }
  });

  it('stops when the caller search budget is exhausted', () => {
    const budget = { remaining: 1 };
    expect(searchOrthogonalRoute({ x: 0, y: 0 }, { x: 300, y: 100 }, [], [], undefined, budget)).toBeUndefined();
    expect(budget.remaining).toBe(0);
  });

  it('reports an enclosed endpoint rather than crossing a hard obstacle', () => {
    expect(searchOrthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [{ x: -10, y: -10, width: 20, height: 20 }], [])).toBeUndefined();
  });
});
