import { describe, expect, it } from 'vitest';
import type { AlignmentGraph, DiagramOrientation } from '../lib/alignment-packs.js';
import { designDocToPack, loadDesignDoc } from '../lib/design-doc.js';
import { buildDiagram, projectDiagram, type Box, type Diagram, type MeasuredGeometry } from './alignment-graph.js';

const orientations: DiagramOrientation[] = ['top-to-bottom', 'left-to-right'];
const authored = () => designDocToPack(loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname)).graph;
const heights: Record<string, number> = {
  'group:design:container:acstack': 106, 'group:design:container:cli': 107,
  'item:user': 94, 'item:design-source': 94, 'item:github': 94, 'item:skills': 94,
  'item:host': 136, 'item:review-runtime': 136, 'item:viewer': 117,
};
function measured(graph: AlignmentGraph, expanded: string[]): MeasuredGeometry {
  const projection = projectDiagram(graph, expanded);
  return {
    nodes: Object.fromEntries(projection.nodes.map(node => [node.id, { width: 300, height: node.kind === 'folded-group' ? 140 : heights[node.id] ?? 140 }])),
    labels: Object.fromEntries(projection.edges.map(edge => [edge.id, { width: 196, height: edge.childEdgeIds.some(id => ['publish-companion', 'review-session'].includes(id)) ? 44 : 28 }])),
  };
}
const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
const overlaps = (a: Box, b: Box) => overlap(a.x, a.x + a.width, b.x, b.x + b.width) > 1e-6 && overlap(a.y, a.y + a.height, b.y, b.y + b.height) > 1e-6;
function expectSafe(diagram: Diagram, sizes: MeasuredGeometry, orientation: DiagramOrientation) {
  const horizontal = orientation === 'left-to-right';
  const obstacles = diagram.nodes.map(node => node.kind === 'group' ? { ...node, height: node.headerHeight! } : node);
  for (const node of diagram.nodes) {
    if (node.kind !== 'group') expect({ width: node.width, height: node.height }).toEqual(sizes.nodes[node.id]);
    if (node.parentId) {
      const parent = diagram.nodes.find(other => other.id === node.parentId)!;
      expect(node.x).toBeGreaterThanOrEqual(parent.x);
      expect(node.y).toBeGreaterThanOrEqual(parent.y + parent.headerHeight!);
      expect(node.x + node.width).toBeLessThanOrEqual(parent.x + parent.width + 1e-6);
      expect(node.y + node.height).toBeLessThanOrEqual(parent.y + parent.height + 1e-6);
    }
  }
  for (const [i, box] of obstacles.entries()) for (const other of obstacles.slice(i + 1)) expect(overlaps(box, other)).toBe(false);
  const runs = (edge: Diagram['edges'][number]) => edge.points.slice(1).map((b, i) => ({ a: edge.points[i], b }));
  for (const edge of diagram.edges) {
    for (const role of ['source', 'target'] as const) {
      const node = diagram.nodes.find(n => n.id === edge[role])!;
      if (node.kind === 'group') continue;
      const point = role === 'source' ? edge.points[0] : edge.points.at(-1)!;
      const inset = role === 'target' ? -2 : 0;
      expect(horizontal ? point.x : point.y).toBeCloseTo(horizontal ? node.x + (role === 'source' ? node.width : inset) : node.y + (role === 'source' ? node.height : inset), 5);
      expect(horizontal ? point.y - node.y : point.x - node.x).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(horizontal ? point.y - node.y : point.x - node.x).toBeLessThanOrEqual((horizontal ? node.height : node.width) - 24 + 1e-6);
    }
    const label = edge.labelBox!;
    expect(label.lines.join(' ')).toBe(edge.label);
    for (const box of [...obstacles, ...diagram.edges.filter(other => other !== edge).map(other => other.labelBox!)]) expect(overlaps(label, box)).toBe(false);
    for (const { a, b } of runs(edge)) {
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const box of [...obstacles, ...diagram.edges.filter(other => other !== edge).map(other => other.labelBox!)]) {
        const enters = a.x === b.x
          ? a.x > box.x + 1e-6 && a.x < box.x + box.width - 1e-6 && overlap(a.y, b.y, box.y, box.y + box.height) > 1e-6
          : a.y > box.y + 1e-6 && a.y < box.y + box.height - 1e-6 && overlap(a.x, b.x, box.x, box.x + box.width) > 1e-6;
        expect(enters, `${edge.id} crosses ${box.x},${box.y}`).toBe(false);
      }
    }
  }
  for (const [i, first] of diagram.edges.entries()) for (const second of diagram.edges.slice(i + 1)) for (const a of runs(first)) for (const b of runs(second)) {
    const vertical = a.a.x === a.b.x && b.a.x === b.b.x;
    const horizontalRun = a.a.y === a.b.y && b.a.y === b.b.y;
    if (!vertical && !horizontalRun) continue;
    const axis = vertical ? 'y' : 'x';
    const across = vertical ? 'x' : 'y';
    if (overlap(a.a[axis], a.b[axis], b.a[axis], b.b[axis]) > 12 + 1e-6) expect(Math.abs(a.a[across] - b.a[across])).toBeGreaterThanOrEqual(12 - 1e-6);
  }
}
function chain(): AlignmentGraph {
  return {
    groups: [{ id: 'design:root', label: 'Root', summary: 'Root', sourceRefs: [] }],
    nodes: ['first', 'second', 'third'].map(id => ({ id, groupId: 'design:root', label: id, summary: id, sourceRefs: [] })),
    edges: ['first', 'second'].map((id, i) => ({ id, fromNodeId: id, toNodeId: ['second', 'third'][i], label: 'Transfers', summary: 'Transfers', relationship: 'design', sourceRefs: [] })), aggregateEdges: [],
  };
}

describe('axis-aware design placement', () => {
  it.each(orientations)('advances a measured chain along %s with ports on the flow axis', async orientation => {
    const graph = chain();
    const sizes = measured(graph, []);
    const diagram = await buildDiagram(graph, [], sizes, undefined, orientation);
    const axis = orientation === 'left-to-right' ? 'x' : 'y';
    const nodes = graph.nodes.map(n => diagram.nodes.find(node => node.refId === n.id)!);
    expect(nodes[1][axis]).toBeGreaterThan(nodes[0][axis] + (axis === 'x' ? nodes[0].width : nodes[0].height));
    expect(nodes[2][axis]).toBeGreaterThan(nodes[1][axis] + (axis === 'x' ? nodes[1].width : nodes[1].height));
    expectSafe(diagram, sizes, orientation);
  });

  it.each([false, true])('aligns normal public setup and skills with CLI expanded=%s', async cliExpanded => {
    const graph = authored();
    const expanded = graph.groups.filter(g => cliExpanded || g.ownerNodeId !== 'cli').map(g => g.id);
    const sizes = measured(graph, expanded);
    const diagram = await buildDiagram(graph, expanded, sizes);
    const x = diagram.nodes.find(n => n.refId === 'host')!.x;
    expect(diagram.nodes.find(n => n.refId === 'skills')!.x).toBeCloseTo(x, 5);
    if (cliExpanded) expect(diagram.nodes.find(n => n.refId === 'review-runtime')!.x).toBeCloseTo(x, 5);
    expectSafe(diagram, sizes, 'top-to-bottom');
  });

  it.each([{ orientation: 'top-to-bottom' as const, tall: false }, { orientation: 'top-to-bottom' as const, tall: true }, { orientation: 'left-to-right' as const, tall: false }])('preserves nested public geometry and hints in $orientation, tall=$tall', async ({ orientation, tall }) => {
    const graph = authored();
    graph.edges.reverse();
    let previous: Diagram | undefined;
    for (const expanded of [graph.groups.map(g => g.id), ['design:root', 'design:container:acstack'], graph.groups.map(g => g.id)]) {
      const sizes = measured(graph, expanded);
      if (tall) {
        for (const size of Object.values(sizes.nodes)) size.height += 60;
        for (const size of Object.values(sizes.labels)) { size.width = 220; size.height = 92; }
      }
      const snapshot = structuredClone({ graph, expanded, sizes, previous });
      const diagram = await buildDiagram(graph, expanded, sizes, previous, orientation);
      expect({ graph, expanded, sizes, previous }).toEqual(snapshot);
      expectSafe(diagram, sizes, orientation);
      previous = diagram;
    }
  });

  it.each(orientations)('keeps owned container ports outside top headers in %s', async orientation => {
    const graph = chain();
    graph.groups.push({ id: 'frame', parentGroupId: 'design:root', ownerNodeId: 'second', label: 'Frame', summary: 'Frame', sourceRefs: [] });
    graph.nodes[1].groupId = 'frame';
    graph.nodes[2].groupId = 'frame';
    graph.edges = graph.edges.slice(1);
    const sizes = measured(graph, ['frame']);
    sizes.nodes['group:frame'].height = 220;
    for (const label of Object.values(sizes.labels)) label.width = 64;
    const diagram = await buildDiagram(graph, ['frame'], sizes, undefined, orientation);
    expectSafe(diagram, sizes, orientation);
    expect(diagram.nodeToVisible.second).toBe('group:frame');
    const frame = diagram.nodes.find(n => n.id === 'group:frame')!;
    const port = diagram.edges[0].points[0];
    expect(port.x).toBe(frame.x);
    expect(port.y).toBeGreaterThanOrEqual(frame.y + frame.headerHeight! + 32);
    expect(port.y).toBeLessThanOrEqual(frame.y + frame.height - 32);
  });

  it('keeps oversized horizontal labels safe or reports that no safe layout was found', async () => {
    const graph = authored();
    const expanded = graph.groups.map(g => g.id);
    const sizes = measured(graph, expanded);
    for (const size of Object.values(sizes.nodes)) size.height += 60;
    for (const size of Object.values(sizes.labels)) { size.width = 220; size.height = 92; }
    const snapshot = structuredClone({ graph, expanded, sizes });
    let diagram: Diagram;
    try {
      diagram = await buildDiagram(graph, expanded, sizes, undefined, 'left-to-right');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Cannot route relationships or place labels without overlap');
      expect({ graph, expanded, sizes }).toEqual(snapshot);
      return;
    }
    expect({ graph, expanded, sizes }).toEqual(snapshot);
    expectSafe(diagram, sizes, 'left-to-right');
  });

  it('keeps default legacy placement and explicit default design placement unchanged', async () => {
    const graph = chain();
    const sizes = measured(graph, []);
    expect(await buildDiagram(graph, [], sizes)).toEqual(await buildDiagram(graph, [], sizes, undefined, 'top-to-bottom'));
    graph.groups[0].id = 'legacy';
    for (const node of graph.nodes) node.groupId = 'legacy';
    const legacy = await buildDiagram(graph, ['legacy']);
    const nodes = graph.nodes.map(n => legacy.nodes.find(node => node.refId === n.id)!);
    expect(nodes[1].x).toBeGreaterThan(nodes[0].x);
  });
});
