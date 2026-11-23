import { describe, expect, it } from 'vitest';
import type { Box, DiagramEdge, DiagramNode, Point } from './alignment-graph.js';
import { projectDiagram } from './alignment-graph.js';
import { layoutFixtures } from './layout-fixtures.js';
import { placeDiagram } from './layout-place.js';
import { routeDiagram } from './layout-route.js';
import { estimateGeometry, expandStates } from './layout-scorecard.js';

const card = (id: string, x: number, y: number, width = 300, height = 118): DiagramNode =>
  ({ id, kind: 'item', refId: id, label: id, summary: '', x, y, width, height });
const edge = (id: string, source: string, target: string, label = ''): DiagramEdge =>
  ({ id, source, target, label, childEdgeIds: [], points: [], path: '' });
const runs = (points: Point[]) => points.slice(1).map((b, i) => [points[i], b] as const);
const bends = (points: Point[]) => Math.max(0, points.length - 2);
// Whether a run enters a box's interior (touching its border does not count).
const through = ([a, b]: readonly [Point, Point], box: Box) =>
  Math.max(a.x, b.x) > box.x + 2 && Math.min(a.x, b.x) < box.x + box.width - 2
  && Math.max(a.y, b.y) > box.y + 2 && Math.min(a.y, b.y) < box.y + box.height - 2;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('routeDiagram', () => {
  it('draws aligned cards with one straight run between facing sides', () => {
    const [route] = routeDiagram([card('a', 0, 0), card('b', 500, 0)], [edge('ab', 'a', 'b')], {}, 'left-to-right');
    expect(route.unrouted).toBeUndefined();
    expect(route.points).toHaveLength(2);
    expect(route.points[0].x).toBe(300);
    expect(route.points[1].x).toBeGreaterThan(490);
    expect(route.points[1].x).toBeLessThanOrEqual(500);
    expect(route.path.startsWith('M')).toBe(true);
  });

  it('uses orthogonal runs with at most two bends for offset cards', () => {
    const [route] = routeDiagram([card('a', 0, 0), card('b', 500, 300)], [edge('ab', 'a', 'b')], {}, 'left-to-right');
    expect(route.unrouted).toBeUndefined();
    for (const [a, b] of runs(route.points)) expect(a.x === b.x || a.y === b.y).toBe(true);
    expect(bends(route.points)).toBeLessThanOrEqual(2);
  });

  it('routes around a card standing in the way', () => {
    const nodes = [card('a', 0, 0), card('block', 400, 0), card('b', 800, 0)];
    const [route] = routeDiagram(nodes, [edge('ab', 'a', 'b')], {}, 'left-to-right');
    expect(route.unrouted).toBeUndefined();
    expect(runs(route.points).some(run => through(run, nodes[1]))).toBe(false);
  });

  it('spreads arrows that share a side onto separate ports', () => {
    const routes = routeDiagram([card('a', 0, 0), card('b', 500, 0)], [edge('1', 'a', 'b'), edge('2', 'a', 'b')], {}, 'left-to-right');
    expect(routes[0].points[0].x).toBe(routes[1].points[0].x);
    expect(routes[0].points[0].y).not.toBe(routes[1].points[0].y);
  });

  it('keeps a label clear of every card, centred on a run of its arrow', () => {
    const nodes = [card('a', 0, 0), card('b', 600, 0)];
    const [route] = routeDiagram(nodes, [edge('ab', 'a', 'b', 'reads from')], { ab: { width: 100, height: 28 } }, 'left-to-right');
    const box = route.labelBox!;
    expect(route.labelUnplaced).toBeUndefined();
    expect(nodes.some(node => overlaps(box, node))).toBe(false);
    expect(box.y + box.height / 2).toBe(route.points[0].y);
  });

  it('flags a label with no clear spot and still gives it a box', () => {
    const nodes = [card('a', 0, 0), card('b', 340, 0)];
    const [route] = routeDiagram(nodes, [edge('ab', 'a', 'b', 'a label far wider than the gap')], { ab: { width: 400, height: 200 } }, 'left-to-right');
    expect(route.labelUnplaced).toBe(true);
    expect(route.labelBox).toBeDefined();
  });

  it('reroutes an arrow whose label fits nowhere clear on it, keeping every label on its own arrow, off cards, other labels, and other arrows', () => {
    const nodes = [card('a', 0, 0, 200, 60), card('b', 460, 60, 200, 60), card('c', 0, 100, 200, 60), card('d', 320, 140, 200, 60)];
    const edges = [edge('e1', 'a', 'b', 'e1'), edge('e2', 'a', 'c', 'e2'), edge('e3', 'c', 'b', 'e3'), edge('e4', 'c', 'd', 'e4')];
    const sizes = { e1: { width: 140, height: 28 }, e2: { width: 140, height: 44 }, e3: { width: 100, height: 28 }, e4: { width: 100, height: 44 } };
    const routes = routeDiagram(nodes, edges, sizes, 'left-to-right');
    const boxes = routes.map(route => route.labelBox!);
    expect(routes.some(route => route.labelUnplaced)).toBe(false);
    const runs = (points: Point[]) => points.slice(1).map((end, k) => ({ x: Math.min(points[k].x, end.x), y: Math.min(points[k].y, end.y), width: Math.abs(end.x - points[k].x) || 1, height: Math.abs(end.y - points[k].y) || 1 }));
    for (const [i, box] of boxes.entries()) {
      const points = routes[i].points;
      expect(points.slice(1).some((end, k) => overlaps(box, { x: Math.min(points[k].x, end.x), y: Math.min(points[k].y, end.y), width: Math.abs(end.x - points[k].x) || 1, height: Math.abs(end.y - points[k].y) || 1 })), `${routes[i].id} label leaves its arrow`).toBe(true);
      expect(nodes.some(node => overlaps(box, node))).toBe(false);
      expect(boxes.slice(i + 1).some(other => overlaps(box, other))).toBe(false);
      expect(routes.some((other, j) => j !== i && runs(other.points).some(run => overlaps(box, run))), `${routes[i].id} label covers another arrow`).toBe(false);
    }
  });

  it('flags an edge with a missing end instead of throwing', () => {
    const routes = routeDiagram([card('a', 0, 0)], [edge('gone', 'a', 'missing')], {}, 'left-to-right');
    expect(routes).toHaveLength(1);
    expect(routes[0].points).toEqual([]);
    expect(routes[0].unrouted).toBe(true);
  });

  it('never throws on empty, self-loop, or overlapping input', () => {
    const nodes = [card('a', 0, 0), card('b', 0, 0), card('c', 400, 0)];
    expect(routeDiagram([], [], {}, 'top-to-bottom')).toEqual([]);
    const routes = routeDiagram(nodes, [edge('1', 'a', 'a'), edge('2', 'a', 'b'), edge('3', 'b', 'c'), edge('4', 'b', 'c')], {}, 'top-to-bottom');
    expect(routes).toHaveLength(4);
    for (const route of routes) expect(typeof route.path).toBe('string');
  });

  it('flags every arrow through a card and every label on a card, on every fixture view', () => {
    for (const orientation of ['left-to-right', 'top-to-bottom'] as const) for (const graph of Object.values(layoutFixtures)) {
      for (const [, expanded] of expandStates(graph)) {
        const measured = estimateGeometry(graph, expanded);
        const placed = placeDiagram(projectDiagram(graph, expanded), measured, orientation);
        const cards = placed.nodes.filter(node => node.kind !== 'group');
        for (const route of routeDiagram(placed.nodes, placed.edges, measured.labels, orientation)) {
          const crossed = cards.some(node => node.id !== route.source && node.id !== route.target && runs(route.points).some(run => through(run, node)));
          if (crossed) expect(route.unrouted).toBe(true);
          if (route.labelBox && cards.some(node => overlaps(route.labelBox!, node))) expect(route.labelUnplaced).toBe(true);
        }
      }
    }
  }, 60_000);
});
