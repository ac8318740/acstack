import { describe, expect, it } from 'vitest';
import { AlignmentPackSchema } from '../lib/alignment-packs.js';
import { buildDiagram, projectDiagram, type Box, type Diagram, type DiagramEdge, type MeasuredGeometry, type Point } from './alignment-graph.js';

// Wholly invented orchard fixture; retains all ten elements and seven relationships.
function fixture() {
  const groupId = (id: string) => `design:container:${id}`;
  return AlignmentPackSchema.parse({
    packVersion: 'full-expansion@v1', source: { map: { id: 'full-expansion', version: 'v1' } },
    graph: {
      groups: [
        { id: 'design:root', label: 'Invented orchard workshop', summary: 'Independent synthetic fixture' },
        ...[
          ['orchard', 'design:root', 'Orchard cluster'],
          ['sorting', groupId('orchard'), 'Sorting room'],
          ['ledger', 'design:root', 'Ledger cluster'],
        ].map(([id, parentGroupId, label]) => ({ id: groupId(id), ownerNodeId: id, parentGroupId, label, summary: label })),
      ],
      nodes: [
        ['orchard', 'orchard', 'Orchard cluster'],
        ['sorting', 'sorting', 'Sorting room'],
        ['seed', 'sorting', 'Seed reader'],
        ['grade', 'sorting', 'Grade calculator'],
        ['basket', 'orchard', 'Basket maker'],
        ['ledger', 'ledger', 'Ledger cluster'],
        ['archive', 'ledger', 'Archive shelf'],
        ['index', 'ledger', 'Index builder'],
        ['courier', '', 'Courier kiosk'],
        ['observer', '', 'Weather observer'],
      ].map(([id, parent, label]) => ({
        id, groupId: parent ? groupId(parent) : 'design:root', label, summary: label,
        elementKind: id === 'archive' ? 'store' : 'component', channels: ['cli'],
      })),
      edges: [
        ['a', 'seed', 'grade', 'Scores batches'],
        ['e', 'courier', 'seed', 'Requests seed scan'],
        ['b', 'grade', 'basket', 'Prepares baskets'],
        ['g', 'grade', 'index', 'Updates grade index'],
        ['c', 'basket', 'archive', 'Stores basket counts'],
        ['d', 'basket', 'archive', 'Checks stored counts'],
        ['f', 'observer', 'index', 'Sends weather notes'],
      ].map(([id, fromNodeId, toNodeId, label]) => ({
        id, fromNodeId, toNodeId, label, summary: label, relationship: 'design', direction: 'one-way',
      })),
      aggregateEdges: [],
    },
    viewState: { globalDepth: 1, expandedGroups: [], semanticZoom: 'business' },
  }).graph;
}

// Browser-measured sizes in diagram pixels, without saved node positions.
function measured(graph: ReturnType<typeof fixture>, expanded: string[], mode: 'business' | 'technical' | 'collapsed'): MeasuredGeometry {
  const projection = projectDiagram(graph, expanded);
  return {
    nodes: Object.fromEntries(projection.nodes.map(node => [node.id, {
      width: 300,
      height: mode === 'collapsed' ? (node.kind === 'folded-group' ? 152 : 118)
        : node.kind === 'group' ? (mode === 'business' ? 126 : 150) : (mode === 'business' ? 94 : 118),
    }])),
    labels: Object.fromEntries(projection.edges.map(edge => [edge.id, { width: 196, height: 28 }])),
  };
}

const epsilon = 1e-6;
const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
const overlaps = (a: Box, b: Box) => overlap(a.x, a.x + a.width, b.x, b.x + b.width) > epsilon
  && overlap(a.y, a.y + a.height, b.y, b.y + b.height) > epsilon;
const segments = (edge: DiagramEdge) => edge.points.slice(1).map((end, index) => ({ start: edge.points[index], end }));

function entersBox({ start, end }: { start: Point; end: Point }, box: Box) {
  return Math.abs(start.x - end.x) < epsilon
    ? start.x > box.x + epsilon && start.x < box.x + box.width - epsilon && overlap(start.y, end.y, box.y, box.y + box.height) > epsilon
    : start.y > box.y + epsilon && start.y < box.y + box.height - epsilon && overlap(start.x, end.x, box.x, box.x + box.width) > epsilon;
}

function expectReadable(diagram: Diagram, sizes: MeasuredGeometry) {
  expect(diagram.nodes.map(node => node.id).sort()).toEqual([
    'group:design:container:ledger', 'group:design:container:orchard', 'group:design:container:sorting',
    'item:archive', 'item:basket', 'item:courier', 'item:grade', 'item:index', 'item:observer', 'item:seed',
  ]);
  expect(diagram.edges).toHaveLength(7);
  expect(diagram.edges.flatMap(edge => edge.childEdgeIds).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  for (const node of diagram.nodes) {
    const size = sizes.nodes[node.id];
    if (node.kind === 'group') {
      expect(node.headerHeight, node.id).toBe(size.height);
      expect(node.width, node.id).toBeGreaterThanOrEqual(size.width);
    } else {
      expect(node.kind, node.id).toBe('item');
      expect({ width: node.width, height: node.height }, node.id).toEqual(size);
    }
    if (node.parentId) {
      const parent = diagram.nodes.find(candidate => candidate.id === node.parentId)!;
      expect(node.x, node.id).toBeGreaterThanOrEqual(parent.x);
      expect(node.y, node.id).toBeGreaterThanOrEqual(parent.y + parent.headerHeight!);
      expect(node.x + node.width, node.id).toBeLessThanOrEqual(parent.x + parent.width);
      expect(node.y + node.height, node.id).toBeLessThanOrEqual(parent.y + parent.height);
    }
  }
  const obstacles = diagram.nodes.map(node => node.kind === 'group' ? { ...node, height: node.headerHeight! } : node);
  for (const [index, box] of obstacles.entries()) {
    for (const other of obstacles.slice(index + 1)) expect(overlaps(box, other), `${box.id} overlaps ${other.id}`).toBe(false);
  }
  for (const edge of diagram.edges) {
    const authored = fixture().edges.find(candidate => candidate.id === edge.childEdgeIds[0])!;
    expect(edge.source, edge.id).toBe(`item:${authored.fromNodeId}`);
    expect(edge.target, edge.id).toBe(`item:${authored.toNodeId}`);
    expect(edge.points.length, edge.id).toBeGreaterThanOrEqual(2);
    for (const [id, point] of [[edge.source, edge.points[0]], [edge.target, edge.points.at(-1)!]] as const) {
      const box = diagram.nodes.find(node => node.id === id)!;
      // Existing arrowheads can stop 2px outside a card; no attachment side is prescribed.
      const horizontal = point.x >= box.x - epsilon && point.x <= box.x + box.width + epsilon
        && Math.min(Math.abs(point.y - box.y), Math.abs(point.y - box.y - box.height)) <= 2 + epsilon;
      const vertical = point.y >= box.y - epsilon && point.y <= box.y + box.height + epsilon
        && Math.min(Math.abs(point.x - box.x), Math.abs(point.x - box.x - box.width)) <= 2 + epsilon;
      expect(horizontal || vertical, `${edge.id} must attach to ${id}`).toBe(true);
    }
    const label = edge.labelBox!;
    expect(label.lines.join(' '), edge.id).toBe(authored.label);
    expect({ width: label.width, height: label.height }, edge.id).toEqual(sizes.labels[edge.id]);
    const otherLabels = diagram.edges.filter(other => other !== edge).map(other => other.labelBox!);
    for (const box of [...obstacles, ...otherLabels]) expect(overlaps(label, box), `${edge.id} label overlap`).toBe(false);
    for (const segment of segments(edge)) {
      const { start, end } = segment;
      expect([start.x, start.y, end.x, end.y].every(Number.isFinite), edge.id).toBe(true);
      expect(Math.abs(start.x - end.x) + Math.abs(start.y - end.y), `${edge.id} has a zero-length segment`).toBeGreaterThan(epsilon);
      expect(Math.abs(start.x - end.x) < epsilon || Math.abs(start.y - end.y) < epsilon, `${edge.id} must stay axis-aligned`).toBe(true);
      for (const box of [...obstacles, ...otherLabels]) {
        expect(entersBox(segment, box), `${edge.id} crosses a card, header, or another label`).toBe(false);
      }
    }
    // These ordinary relationships have no authored self-loops; each route must be a simple walk.
    const routeSegments = segments(edge);
    for (const [index, first] of routeSegments.entries()) {
      for (let next = index + 1; next < routeSegments.length; next += 1) {
        const second = routeSegments[next];
        const xOverlap = overlap(first.start.x, first.end.x, second.start.x, second.end.x);
        const yOverlap = overlap(first.start.y, first.end.y, second.start.y, second.end.y);
        if (next === index + 1) {
          expect(xOverlap > epsilon || yOverlap > epsilon, `${edge.id} backtracks over its preceding segment`).toBe(false);
        } else {
          expect(xOverlap >= -epsilon && yOverlap >= -epsilon, `${edge.id} intersects or retraces itself`).toBe(false);
        }
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
      if (run > 12 + epsilon) expect(clearance, `${a.id} and ${b.id} parallel clearance`).toBeGreaterThanOrEqual(12 - epsilon);
    }
  }
}

describe('full expansion of an invented nested design', () => {
  it.each([
    { mode: 'business' as const, prior: false },
    { mode: 'technical' as const, prior: false },
    { mode: 'business' as const, prior: true },
    { mode: 'technical' as const, prior: true },
  ])('fully expands with readable measured geometry in $mode mode, prior collapsed layout=$prior', async ({ mode, prior }) => {
    const graph = fixture();
    const previous = prior ? await buildDiagram(graph, [], measured(graph, [], 'collapsed')) : undefined;
    const expanded = graph.groups.map(group => group.id);
    const sizes = measured(graph, expanded, mode);
    const diagram = await buildDiagram(graph, expanded, sizes, undefined, previous);
    expectReadable(diagram, sizes);
  });
});
