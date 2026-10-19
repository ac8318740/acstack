import { describe, expect, it } from 'vitest';
import { designDocToPack, loadDesignDoc } from '../lib/design-doc.js';
import type { AlignmentGraph } from '../lib/alignment-packs.js';
import { buildDiagram, projectDiagram, type Box, type Diagram, type DiagramEdge, type MeasuredGeometry } from './alignment-graph.js';

const authoredGraph = () => designDocToPack(loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname)).graph;

// Browser-measured content sizes, in diagram pixels; no saved positions or layout settings.
const contentHeights: Record<string, number> = {
  'group:design:container:acstack': 106,
  'group:design:container:cli': 107,
  'item:user': 94,
  'item:design-source': 94,
  'item:github': 94,
  'item:skills': 94,
  'item:host': 136,
  'item:review-runtime': 136,
  'item:viewer': 117,
};

function measuredGeometry(graph: AlignmentGraph, expanded: string[]): MeasuredGeometry {
  const projection = projectDiagram(graph, expanded);
  return {
    nodes: Object.fromEntries(projection.nodes.map(node => [node.id, {
      width: 300,
      height: node.kind === 'folded-group' ? 140 : contentHeights[node.id],
    }])),
    labels: Object.fromEntries(projection.edges.map(edge => [edge.id, {
      width: 196,
      height: edge.childEdgeIds.some(id => ['publish-companion', 'review-session'].includes(id)) ? 44 : 28,
    }])),
  };
}

function metrics(diagram: Diagram) {
  const boxes = [...diagram.nodes, ...diagram.edges.map(edge => edge.labelBox!)];
  const points = [...boxes.flatMap(box => [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }]), ...diagram.edges.flatMap(edge => edge.points)];
  const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
  const height = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y));
  const routeLength = diagram.edges.reduce((sum, edge) => sum + edge.points.slice(1).reduce((length, point, index) =>
    length + Math.abs(point.x - edge.points[index].x) + Math.abs(point.y - edge.points[index].y), 0), 0);
  return { width, height, area: width * height, routeLength };
}

const epsilon = 1e-6;
const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
const overlaps = (a: Box, b: Box) => overlap(a.x, a.x + a.width, b.x, b.x + b.width) > epsilon
  && overlap(a.y, a.y + a.height, b.y, b.y + b.height) > epsilon;
const segments = (edge: DiagramEdge) => edge.points.slice(1).map((end, index) => ({ start: edge.points[index], end }));

function expectReadable(diagram: Diagram, graph: AlignmentGraph, measured: MeasuredGeometry) {
  expect(diagram.edges.flatMap(edge => edge.childEdgeIds).sort()).toEqual(graph.edges.map(edge => edge.id).sort());
  for (const node of diagram.nodes) {
    const size = measured.nodes[node.id];
    if (node.kind === 'group') {
      expect(node.headerHeight, node.id).toBe(size.height);
      expect(node.width, node.id).toBeGreaterThanOrEqual(size.width);
    } else {
      expect({ width: node.width, height: node.height }, node.id).toEqual(size);
    }
    if (node.parentId) {
      const parent = diagram.nodes.find(candidate => candidate.id === node.parentId)!;
      expect(node.x, node.id).toBeGreaterThanOrEqual(parent.x);
      expect(node.x + node.width, node.id).toBeLessThanOrEqual(parent.x + parent.width);
      expect(node.y, node.id).toBeGreaterThanOrEqual(parent.y + parent.headerHeight!);
      expect(node.y + node.height, node.id).toBeLessThanOrEqual(parent.y + parent.height);
    }
  }
  const obstacles = diagram.nodes.map(node => node.kind === 'group' ? { ...node, height: node.headerHeight! } : node);
  for (const [index, obstacle] of obstacles.entries()) {
    for (const other of obstacles.slice(index + 1)) expect(overlaps(obstacle, other), `${obstacle.id} overlaps ${other.id}`).toBe(false);
  }
  for (const edge of diagram.edges) {
    expect(edge.points.length, edge.id).toBeGreaterThanOrEqual(2);
    for (const id of edge.childEdgeIds) {
      const relationship = graph.edges.find(candidate => candidate.id === id)!;
      expect(edge.source, id).toBe(diagram.nodeToVisible[relationship.fromNodeId]);
      expect(edge.target, id).toBe(diagram.nodeToVisible[relationship.toNodeId]);
    }
    const label = edge.labelBox!;
    expect(label.lines.join(' '), edge.id).toBe(edge.label);
    expect({ width: label.width, height: label.height }, edge.id).toEqual(measured.labels[edge.id]);
    for (const obstacle of obstacles) expect(overlaps(label, obstacle), `${edge.id} label overlaps ${obstacle.id}`).toBe(false);
    for (const other of diagram.edges.filter(other => other !== edge)) {
      expect(overlaps(label, other.labelBox!), `${edge.id} label overlaps ${other.id}`).toBe(false);
    }
    for (const { start, end } of segments(edge)) {
      expect([start.x, start.y, end.x, end.y].every(Number.isFinite), edge.id).toBe(true);
      const vertical = Math.abs(start.x - end.x) < epsilon;
      expect(vertical || Math.abs(start.y - end.y) < epsilon, edge.id).toBe(true);
      const boxes = [...obstacles, ...diagram.edges.filter(other => other !== edge).map(other => other.labelBox!)];
      for (const box of boxes) {
        const enters = vertical
          ? start.x > box.x + epsilon && start.x < box.x + box.width - epsilon && overlap(start.y, end.y, box.y, box.y + box.height) > epsilon
          : start.y > box.y + epsilon && start.y < box.y + box.height - epsilon && overlap(start.x, end.x, box.x, box.x + box.width) > epsilon;
        expect(enters, `${edge.id} crosses a card, header, or another label`).toBe(false);
      }
    }
  }
  for (const [index, a] of diagram.edges.entries()) for (const b of diagram.edges.slice(index + 1)) {
    for (const first of segments(a)) for (const second of segments(b)) {
      const vertical = Math.abs(first.start.x - first.end.x) < epsilon && Math.abs(second.start.x - second.end.x) < epsilon;
      const horizontal = Math.abs(first.start.y - first.end.y) < epsilon && Math.abs(second.start.y - second.end.y) < epsilon;
      if (!vertical && !horizontal) continue;
      const run = vertical
        ? overlap(first.start.y, first.end.y, second.start.y, second.end.y)
        : overlap(first.start.x, first.end.x, second.start.x, second.end.x);
      const clearance = Math.abs(vertical ? first.start.x - second.start.x : first.start.y - second.start.y);
      if (run > 12 + epsilon) expect(clearance, `${a.id} and ${b.id} parallel runs`).toBeGreaterThanOrEqual(12 - epsilon);
    }
  }
}

describe('measured compact design layout', () => {
  it('materially shrinks both expanded dimensions, occupied area, and connector length', async () => {
    const graph = authoredGraph();
    const expanded = graph.groups.map(group => group.id);
    const diagram = await buildDiagram(graph, expanded, measuredGeometry(graph, expanded));
    expect(diagram.nodes).toHaveLength(9);
    expect(diagram.edges).toHaveLength(6);
    const result = metrics(diagram);
    // Baseline: 1759 x 2016, area 3546144, and 4898px of connectors.
    // Budgets demand improvement on both axes, not a taller or wider rearrangement.
    expect.soft(result.width).toBeLessThanOrEqual(1759 * 0.95);
    expect.soft(result.height).toBeLessThanOrEqual(2016 * 0.95);
    expect.soft(result.area).toBeLessThanOrEqual(3546144 * 0.8);
    expect.soft(result.routeLength).toBeLessThanOrEqual(4898 * 0.9);
  });

  it('places the top actor over the midpoint of its outgoing destinations, not over the external destination', async () => {
    const graph = authoredGraph();
    const expanded = graph.groups.map(group => group.id);
    const diagram = await buildDiagram(graph, expanded, measuredGeometry(graph, expanded));
    const actor = diagram.nodes.find(node => node.id === 'item:user')!;
    const destinations = diagram.edges.filter(edge => edge.source === actor.id)
      .map(edge => diagram.nodes.find(node => node.id === edge.target)!);
    expect(destinations).toHaveLength(2);
    const midpoint = destinations.reduce((sum, node) => sum + node.x + node.width / 2, 0) / destinations.length;
    expect(actor.x).toBeLessThan(midpoint);
    expect(actor.x + actor.width).toBeGreaterThan(midpoint);
  });

  it.each([false, true])('orders ports by local departure and approach, reversed declarations=%s', async reversed => {
    const graph = authoredGraph();
    if (reversed) graph.edges.reverse();
    const expanded = graph.groups.map(group => group.id);
    const measured = measuredGeometry(graph, expanded);
    const diagram = await buildDiagram(graph, expanded, measured);
    for (const node of diagram.nodes.filter(node => node.kind !== 'group')) {
      for (const role of ['source', 'target'] as const) {
        const connected = diagram.edges.filter(edge => edge[role] === node.id).map(edge => {
          const points = role === 'source' ? edge.points : [...edge.points].reverse();
          return { edge, points };
        });
        if (connected.length < 2 || connected.some(({ points }) => points.length < 4
          || points[0].x !== points[1].x || points[1].y !== points[2].y)) continue;
        connected.sort((a, b) => a.points[0].x - b.points[0].x);
        for (let index = 1; index < connected.length; index += 1) {
          expect(connected[index - 1].points[2].x, `${node.id} ${role} port order`)
            .toBeLessThanOrEqual(connected[index].points[2].x + epsilon);
        }
      }
    }
    // The actor's boundary ingress stays left of the host's local approach despite its source being farther right.
    const actor = diagram.edges.find(edge => edge.childEdgeIds.includes('author-design'))!;
    const host = diagram.edges.find(edge => edge.childEdgeIds.includes('load-skills'))!;
    expect(actor.points.at(-1)!.x).toBeLessThan(host.points.at(-1)!.x);
    expectReadable(diagram, graph, measured);
  });

  it.each([false, true])('removes endpoint micro-jogs without crossings between actor departures, reversed declarations=%s', async reversed => {
    const graph = authoredGraph();
    if (reversed) graph.edges.reverse();
    const expanded = graph.groups.map(group => group.id);
    const measured = measuredGeometry(graph, expanded);
    const diagram = await buildDiagram(graph, expanded, measured);
    const left = diagram.edges.find(edge => edge.childEdgeIds.includes('author-design'))!;
    const right = diagram.edges.find(edge => edge.childEdgeIds.includes('publish-companion'))!;
    for (const [edge, direction] of [[left, -1], [right, 1]] as const) {
      const departure = segments(edge).find(({ start, end }) => start.y === end.y && Math.abs(end.x - start.x) >= 12)!;
      expect.soft(Math.sign(departure.end.x - departure.start.x), edge.id).toBe(direction);
    }
    for (const a of segments(left)) for (const b of segments(right)) {
      if ((a.start.x === a.end.x) === (b.start.x === b.end.x)) continue;
      const [vertical, horizontal] = a.start.x === a.end.x ? [a, b] : [b, a];
      const crosses = vertical.start.x > Math.min(horizontal.start.x, horizontal.end.x) + epsilon
        && vertical.start.x < Math.max(horizontal.start.x, horizontal.end.x) - epsilon
        && horizontal.start.y > Math.min(vertical.start.y, vertical.end.y) + epsilon
        && horizontal.start.y < Math.max(vertical.start.y, vertical.end.y) - epsilon;
      expect.soft(crosses, 'actor departures must not cross').toBe(false);
    }
    expectReadable(diagram, graph, measured);
  });

  it.each([false, true])('orders incoming elbow ports by approach with reversed declarations=%s', async reversed => {
    const graph = authoredGraph();
    graph.groups = graph.groups.filter(group => group.id === 'design:root');
    graph.nodes = ['west', 'east', 'target'].map(id => ({ ...graph.nodes[0], id, label: id, groupId: 'design:root' }));
    graph.edges = ['west', 'east'].map(id => ({ ...graph.edges[0], id, fromNodeId: id, toNodeId: 'target', label: 'Feeds' }));
    graph.aggregateEdges = [];
    if (reversed) graph.edges.reverse();
    const measured = measuredGeometry(graph, []);
    for (const size of Object.values(measured.nodes)) size.height = 94;
    const diagram = await buildDiagram(graph, [], measured);
    const incoming = [...diagram.edges].sort((a, b) => a.points.at(-1)!.x - b.points.at(-1)!.x);
    expect(incoming).toHaveLength(2);
    for (const edge of incoming) expect(edge.points.length).toBeGreaterThanOrEqual(4);
    expect(incoming[0].points.at(-3)!.x).toBeLessThan(incoming[1].points.at(-3)!.x);
    expect(incoming[1].points.at(-1)!.x - incoming[0].points.at(-1)!.x).toBe(80);
    expectReadable(diagram, graph, measured);
  });

  it('keeps measured content, hierarchy, relationships, labels, and 12px connector clearance intact', async () => {
    const graph = authoredGraph();
    const expanded = graph.groups.map(group => group.id);
    const measured = measuredGeometry(graph, expanded);
    const diagram = await buildDiagram(graph, expanded, measured);
    expect(diagram.nodes.find(node => node.id === 'item:viewer')?.parentId).toBe('group:design:container:cli');
    expect(diagram.nodes.find(node => node.id === 'group:design:container:cli')?.parentId).toBe('group:design:container:acstack');
    expect(diagram.edges.find(edge => edge.childEdgeIds.includes('review-session'))?.bidirectional).toBe(true);
    expectReadable(diagram, graph, measured);
  });

  it('does not enlarge the already compact four-card collapsed view', async () => {
    const graph = authoredGraph();
    const expanded = ['design:root'];
    const diagram = await buildDiagram(graph, expanded, measuredGeometry(graph, expanded));
    expect(diagram.nodes).toHaveLength(4);
    const result = metrics(diagram);
    expect(result.width).toBeLessThanOrEqual(664);
    expect(result.height).toBeLessThanOrEqual(568);
  });

  it('keeps the captured toggle anchor exact with measured content in both states', async () => {
    const graph = authoredGraph();
    const anchor = { id: 'group:design:container:acstack', x: -125.125, y: 87.375 };
    for (const expanded of [graph.groups.map(group => group.id), ['design:root']]) {
      const diagram = await buildDiagram(graph, expanded, measuredGeometry(graph, expanded), anchor);
      expect(diagram.nodes.find(node => node.id === anchor.id)).toMatchObject(anchor);
    }
  });

  it('keeps longer measured labels readable when relationship declaration order changes', async () => {
    const graph = authoredGraph();
    graph.edges.reverse();
    for (const edge of graph.edges) edge.label = `${edge.label} during the local design review`;
    const expanded = graph.groups.map(group => group.id);
    const measured = measuredGeometry(graph, expanded);
    for (const label of Object.values(measured.labels)) { label.width = 220; label.height = 92; }
    const diagram = await buildDiagram(graph, expanded, measured);
    expectReadable(diagram, graph, measured);
  });
});
