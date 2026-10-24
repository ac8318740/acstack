import { describe, expect, it } from 'vitest';
import { AlignmentPackSchema } from '../lib/alignment-packs.js';
import { designDocToPack, loadDesignDoc } from '../lib/design-doc.js';
import { buildDiagram, edgePath, initialExpandedGroups, projectDiagram, reconcileSelection, placeLabels, wrapLabel } from './alignment-graph.js';

const node = (id: string, groupId: string) => ({ id, groupId, label: `Item ${id}`, summary: `Summary ${id}` });
const edge = (from: string, to: string, label = `${from} feeds ${to}`) => ({
  id: `${from}-${to}`,
  fromNodeId: from,
  toNodeId: to,
  relationship: 'feeds',
  label,
  summary: label,
  sourceRefs: [],
});

function samplePack() {
  return AlignmentPackSchema.parse({
    packVersion: 'demo@v1',
    source: { map: { id: 'demo', version: 'v1' } },
    graph: {
      groups: [
        { id: 'journey', label: 'Journey', summary: 'What the customer sees' },
        { id: 'platform', label: 'Platform', summary: 'What runs it' },
        { id: 'payments', parentGroupId: 'platform', label: 'Payments', summary: 'Money' },
      ],
      nodes: [node('cart', 'journey'), node('pay', 'journey'), node('auth', 'payments'), node('capture', 'payments'), node('stock', 'platform')],
      edges: [edge('cart', 'pay'), edge('pay', 'auth'), edge('pay', 'capture'), edge('auth', 'stock'), edge('stock', 'capture')],
      aggregateEdges: [{ fromGroupId: 'journey', toGroupId: 'platform', label: 'Customer actions start platform work', childEdgeIds: [] }],
    },
    viewState: { globalDepth: 1, expandedGroups: ['payments'], semanticZoom: 'business' },
  });
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('alignment diagram', () => {
  it.each([{ expanded: [] }, { expanded: ['platform', 'payments'] }])('returns document comment targets to the overview with expanded groups $expanded', ({ expanded }) => {
    const graph = samplePack().graph;
    graph.groups.push({ id: 'design:root', label: 'Checkout design', summary: 'Whole document', sourceRefs: [] });
    graph.nodes.push({ ...node('overview-child', 'design:root'), sourceRefs: [] });
    const diagram = projectDiagram(graph, expanded);
    let selected = reconcileSelection('item:overview-child', diagram, graph);
    expect(selected).toBe('item:overview-child');
    selected = reconcileSelection('group:design:root', diagram, graph);
    expect(selected).toBeNull();
    expect(reconcileSelection('group:platform', diagram, graph)).toBe('group:platform');
    expect(reconcileSelection('item:auth', diagram, graph)).toBe(expanded.length ? 'item:auth' : 'group:platform');
    expect(reconcileSelection('group:payments', diagram, graph)).toBe(expanded.length ? 'group:payments' : 'group:platform');
  });

  it('expands groups above the global depth plus the named ones', () => {
    expect(initialExpandedGroups(samplePack()).sort()).toEqual(['journey', 'payments', 'platform']);
  });

  it('lays out every item without overlapping boxes, inside its group frame', async () => {
    const pack = samplePack();
    const diagram = await buildDiagram(pack.graph, initialExpandedGroups(pack));
    const items = diagram.nodes.filter(item => item.kind === 'item');

    expect(items.map(item => item.refId).sort()).toEqual(['auth', 'capture', 'cart', 'pay', 'stock']);
    for (const [index, a] of items.entries()) for (const b of items.slice(index + 1)) expect(overlaps(a, b)).toBe(false);
    for (const item of items) {
      const frame = diagram.nodes.find(candidate => candidate.id === item.parentId);
      expect(frame).toBeDefined();
      expect(item.x).toBeGreaterThanOrEqual(frame!.x);
      expect(item.y + item.height).toBeLessThanOrEqual(frame!.y + frame!.height);
    }
    expect(diagram.nodes.findIndex(item => item.id === 'group:platform')).toBeLessThan(
      diagram.nodes.findIndex(item => item.id === 'group:payments')
    );
    for (const route of diagram.edges) {
      expect(route.points.length).toBeGreaterThanOrEqual(2);
      expect(route.path).toMatch(/^M /);
      expect(route.labelBox?.lines.join(' ')).toBe(route.label);
      for (const item of items) expect(overlaps(route.labelBox!, item)).toBe(false);
      // The line breaks around its label: one move to start, one to resume after the gap.
      expect(route.path.match(/M /g)).toHaveLength(2);
    }
  });

  it('folds a collapsed group into one box and merges the edges it hides', async () => {
    const diagram = await buildDiagram(samplePack().graph, ['journey']);

    expect(diagram.nodes.map(item => item.id).sort()).toEqual(['group:journey', 'group:platform', 'item:cart', 'item:pay']);
    expect(diagram.nodes.find(item => item.id === 'group:platform')).toMatchObject({ kind: 'folded-group', itemCount: 3 });
    expect(diagram.edges).toHaveLength(2);
    expect(diagram.edges.find(route => route.target === 'group:platform')).toMatchObject({
      source: 'item:pay',
      label: '2 links',
      childEdgeIds: ['pay-auth', 'pay-capture'],
    });
  });

  it('uses the declared aggregate label when both ends are folded groups', async () => {
    const diagram = await buildDiagram(samplePack().graph, []);

    expect(diagram.edges).toEqual([
      expect.objectContaining({ source: 'group:journey', target: 'group:platform', label: 'Customer actions start platform work' }),
    ]);
  });

  it('hops over crossing lines and rounds corners', () => {
    const path = edgePath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [{ x: 40, y: 0 }]
    );

    expect(path).toBe('M 0 0 L 35 0 A 5 5 0 0 1 45 0 L 94 0 Q 100 0 100 6 L 100 50');
  });

  it('breaks the line where its label sits', () => {
    const path = edgePath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      [],
      { x: -20, y: 40, width: 40, height: 20 }
    );

    expect(path).toBe('M 0 0 L 0 40 M 0 60 L 0 100');
  });

  it('maps owned headers and folded cards to one owner, not duplicate items', async () => {
    const pack = samplePack();
    pack.graph.groups.find(group => group.id === 'payments')!.ownerNodeId = 'auth';
    pack.graph.nodes.find(node => node.id === 'auth')!.groupId = 'payments';
    pack.graph.edges = [edge('auth', 'capture'), edge('capture', 'auth'), edge('stock', 'auth')];
    for (const expanded of [['journey', 'platform', 'payments'], ['journey', 'platform']]) {
      const projected = projectDiagram(pack.graph, expanded);
      expect(projected.nodeToVisible.auth).toBe('group:payments');
      expect(projected.nodes.some(node => node.id === 'item:auth')).toBe(false);
      const geometry = { nodes: Object.fromEntries(projected.nodes.map(node => [node.id, { width: 300, height: 210 }])), labels: Object.fromEntries(projected.edges.map(route => [route.id, { width: 196, height: 64 }])) };
      const diagram = await buildDiagram(pack.graph, expanded, geometry);
      expect(reconcileSelection('item:auth', diagram, pack.graph)).toBe('group:payments');
      expect(reconcileSelection('item:cart', diagram, pack.graph)).toBe('item:cart');
      if (expanded.includes('payments')) {
        expect(diagram.edges).toHaveLength(3);
        expect(diagram.edges.every(route => route.points.length > 1)).toBe(true);
        expect(diagram.nodeToVisible.capture).toBe('item:capture');
      } else {
        expect(diagram.nodeToVisible.capture).toBe('group:payments');
        expect(reconcileSelection('edge:auth-capture', diagram, pack.graph)).toBe('group:payments');
        expect(reconcileSelection('edge:stock-auth', diagram, pack.graph)).toBe('edge:stock-auth');
      }
    }
  });

  it.each([140, 246])('keeps actual compound routes outside measured %ipx headers', async headerHeight => {
    const pack = designDocToPack(loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname));
    const expanded = pack.graph.groups.map(group => group.id);
    const projection = projectDiagram(pack.graph, expanded);
    const measured = {
      nodes: Object.fromEntries(projection.nodes.map(node => [node.id, { width: 300, height: node.kind === 'group' ? headerHeight : 164 }])),
      labels: Object.fromEntries(projection.edges.map(edge => [edge.id, { width: 196, height: 72 }])),
    };
    const diagram = await buildDiagram(pack.graph, expanded, measured);
    expect(diagram.edges.some(edge => edge.childEdgeIds.includes('render-design'))).toBe(false);
    expect(diagram.nodes.find(node => node.id === 'item:viewer')?.parentId).toBe('group:design:container:cli');
    const developer = diagram.edges.find(edge => edge.childEdgeIds.includes('author-design'))!;
    const host = diagram.edges.find(edge => edge.childEdgeIds.includes('load-skills'))!;
    const source = diagram.nodes.find(node => node.id === host.source)!;
    const target = diagram.nodes.find(node => node.id === host.target)!;
    expect(host.points[0].y).toBe(source.y + source.height);
    expect(host.points.at(-1)!.y).toBe(target.y - 2);
    expect(host.points.at(-1)!.x - developer.points.at(-1)!.x).toBeGreaterThanOrEqual(80);
    for (const card of diagram.nodes) expect(card.width).toBeGreaterThanOrEqual(300);
    expect(diagram.edges.flatMap(edge => edge.childEdgeIds).sort()).toEqual(pack.graph.edges.map(edge => edge.id).sort());
    for (const route of diagram.edges) {
      expect(route.path.match(/M /g)).toHaveLength(2);
      expect(route.points.slice(1).every((point, i) => point.x === route.points[i].x || point.y === route.points[i].y)).toBe(true);
      for (const card of diagram.nodes.filter(node => node.kind !== 'group')) expect(overlaps(route.labelBox!, card)).toBe(false);
      for (const other of diagram.edges) if (other !== route) expect(overlaps(route.labelBox!, other.labelBox!)).toBe(false);
      for (const header of diagram.nodes.filter(node => node.kind === 'group')) {
        expect(overlaps(route.labelBox!, { ...header, height: headerHeight })).toBe(false);
        for (const [index, end] of route.points.slice(1).entries()) {
          const start = route.points[index];
          // Strict inequalities permit an endpoint on the border, never a segment through header content.
          const hits = Math.min(start.x, end.x) < header.x + header.width && Math.max(start.x, end.x) > header.x
            && Math.min(start.y, end.y) < header.y + headerHeight && Math.max(start.y, end.y) > header.y;
          expect(hits, `${route.label} crosses ${header.label} header`).toBe(false);
        }
      }
    }
  });

  it.each([3, 4, 6])('routes %i incoming design edges to distinct top ports without shrinking cards', async count => {
    const graph = AlignmentPackSchema.parse({
      ...samplePack(),
      graph: {
        groups: [{ id: 'design:root', label: 'Design', summary: 'Design' }],
        nodes: [...Array.from({ length: count }, (_, index) => node(`source-${index}`, 'design:root')), node('target', 'design:root')],
        edges: Array.from({ length: count }, (_, index) => ({ ...edge(`source-${index}`, 'target', 'Feeds'), relationship: 'design' })),
        aggregateEdges: [],
      },
    }).graph;
    const projected = projectDiagram(graph, []);
    const measured = { nodes: Object.fromEntries(projected.nodes.map(node => [node.id, { width: 300, height: 164 }])), labels: {} };
    const diagram = await buildDiagram(graph, [], measured);
    const target = diagram.nodes.find(node => node.id === 'item:target')!;
    const approaches = diagram.edges.map(route => route.points.at(-1)!);
    expect((approaches[0].x + approaches.at(-1)!.x) / 2).toBeCloseTo(target.x + target.width / 2);
    for (const card of diagram.nodes) expect(card).toMatchObject({ width: 300, height: 164 });
    for (const [index, point] of approaches.entries()) {
      expect(point.y).toBeCloseTo(target.y - 2);
      expect(point.x).toBeGreaterThanOrEqual(target.x + 24);
      expect(point.x).toBeLessThanOrEqual(target.x + target.width - 24);
      // Six ports share the available width between the 24px corner insets.
      if (index) expect(point.x - approaches[index - 1].x).toBeGreaterThanOrEqual(Math.min(80, 252 / (count - 1)) - 0.1);
    }
    for (const route of diagram.edges) {
      const source = diagram.nodes.find(node => node.id === route.source)!;
      // Straightening may slide a source's only port along its bottom edge, inside the corner insets.
      expect(route.points[0].y).toBe(source.y + 164);
      expect(route.points[0].x).toBeGreaterThanOrEqual(source.x + 24);
      expect(route.points[0].x).toBeLessThanOrEqual(source.x + source.width - 24);
      for (const card of diagram.nodes) expect(overlaps(route.labelBox!, card)).toBe(false);
      for (const other of diagram.edges) if (other !== route) expect(overlaps(route.labelBox!, other.labelBox!)).toBe(false);
    }
  });

  it('reports an impossible label rather than placing it over an obstacle', () => {
    const projected = projectDiagram(samplePack().graph, []);
    const route = { ...projected.edges[0], points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], labelBox: { x: 0, y: 0, width: 200, height: 50, lines: ['Impossible'] } };
    expect(placeLabels([], [route])).toEqual([`${route.source} ${route.label} ${route.target}`]);
  });

  it('rejects labels crossed by another route or a second segment of their own route', () => {
    const projected = projectDiagram(samplePack().graph, []);
    const route = { ...projected.edges[0], points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], labelBox: { x: 0, y: 0, width: 60, height: 40, lines: ['A label'] } };
    const crossing = { ...route, id: 'crossing', points: [{ x: 50, y: -100 }, { x: 50, y: 100 }], labelBox: undefined };
    expect(placeLabels([], [route, crossing])).toHaveLength(1);
    route.points.push({ x: 100, y: 12 }, { x: 0, y: 12 });
    expect(placeLabels([], [route])).toHaveLength(1);
  });

  it('never draws a hop back through its label gap', () => {
    expect(edgePath([{ x: 0, y: 0 }, { x: 200, y: 0 }], [{ x: 80, y: 0 }], { x: 60, y: -20, width: 60, height: 40 })).toBe('M 0 0 L 60 0 M 120 0 L 200 0');
  });

  it('wraps long labels onto short lines', () => {
    expect(wrapLabel('on success, reserve stock before charging')).toEqual(['on success, reserve', 'stock before charging']);
  });
});
