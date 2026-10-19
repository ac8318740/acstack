import { describe, expect, it } from 'vitest';
import { AlignmentPackSchema, type AlignmentGraph } from '../lib/alignment-packs.js';
import { designDocToPack, loadDesignDoc } from '../lib/design-doc.js';
import { buildDiagram, projectDiagram, type Box, type Diagram, type DiagramEdge, type Point } from './alignment-graph.js';

type Segment = { start: Point; end: Point; index: number };
const epsilon = 1e-6;
const segments = (route: DiagramEdge): Segment[] => route.points.slice(1).map((end, index) => ({ start: route.points[index], end, index }));
const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));

function parallelConflicts(routes: DiagramEdge[]) {
  const conflicts: string[] = [];
  for (const [index, a] of routes.entries()) for (const b of routes.slice(index + 1)) {
    for (const first of segments(a)) for (const second of segments(b)) {
      const vertical = Math.abs(first.start.x - first.end.x) < epsilon && Math.abs(second.start.x - second.end.x) < epsilon;
      const horizontal = Math.abs(first.start.y - first.end.y) < epsilon && Math.abs(second.start.y - second.end.y) < epsilon;
      if (!vertical && !horizontal) continue; // Perpendicular crossings are allowed.
      const run = vertical
        ? overlap(first.start.y, first.end.y, second.start.y, second.end.y)
        : overlap(first.start.x, first.end.x, second.start.x, second.end.x);
      const clearance = Math.abs(vertical ? first.start.x - second.start.x : first.start.y - second.start.y);
      if (run > 12 + epsilon && clearance < 12 - epsilon) {
        conflicts.push(`${a.childEdgeIds.join(',')} segment ${first.index} ${JSON.stringify([first.start, first.end])} vs ${b.childEdgeIds.join(',')} segment ${second.index} ${JSON.stringify([second.start, second.end])}: ${clearance}px clearance over ${run}px`);
      }
    }
  }
  return conflicts;
}

function entersBox({ start, end }: Segment, box: Box) {
  if (Math.abs(start.x - end.x) < epsilon) {
    return start.x > box.x + epsilon && start.x < box.x + box.width - epsilon
      && overlap(start.y, end.y, box.y, box.y + box.height) > epsilon;
  }
  return start.y > box.y + epsilon && start.y < box.y + box.height - epsilon
    && overlap(start.x, end.x, box.x, box.x + box.width) > epsilon;
}

function expectSafeRoutes(diagram: Diagram, graph: AlignmentGraph) {
  expect(diagram.edges.flatMap(route => route.childEdgeIds).sort()).toEqual(graph.edges.map(edge => edge.id).sort());
  for (const route of diagram.edges) {
    expect(route.points.length, route.id).toBeGreaterThanOrEqual(2);
    for (const childId of route.childEdgeIds) {
      const edge = graph.edges.find(edge => edge.id === childId)!;
      expect(route.source).toBe(diagram.nodeToVisible[edge.fromNodeId]);
      expect(route.target).toBe(diagram.nodeToVisible[edge.toNodeId]);
    }
    for (const [id, point] of [[route.source, route.points[0]], [route.target, route.points.at(-1)!]] as const) {
      const box = diagram.nodes.find(node => node.id === id)!;
      // Arrowheads can stop 2px outside the card; the attachment side remains unconstrained.
      const inset = 2 + epsilon;
      const onHorizontalSide = point.x >= box.x - epsilon && point.x <= box.x + box.width + epsilon
        && Math.min(Math.abs(point.y - box.y), Math.abs(point.y - box.y - box.height)) <= inset;
      const onVerticalSide = point.y >= box.y - epsilon && point.y <= box.y + box.height + epsilon
        && Math.min(Math.abs(point.x - box.x), Math.abs(point.x - box.x - box.width)) <= inset;
      expect(onHorizontalSide || onVerticalSide, `${route.childEdgeIds.join(',')} endpoint ${JSON.stringify(point)} must attach to ${id}`).toBe(true);
    }
    for (const segment of segments(route)) {
      expect([segment.start.x, segment.start.y, segment.end.x, segment.end.y].every(Number.isFinite), route.id).toBe(true);
      expect(Math.abs(segment.start.x - segment.end.x) < epsilon || Math.abs(segment.start.y - segment.end.y) < epsilon, `${route.id} must stay orthogonal`).toBe(true);
      for (const node of diagram.nodes) {
        const obstacle = node.kind === 'group' ? { ...node, height: node.headerHeight! } : node;
        expect(Number.isFinite(obstacle.height), `${node.id} has a measured header`).toBe(true);
        expect(entersBox(segment, obstacle), `${route.childEdgeIds.join(',')} crosses ${node.id}`).toBe(false);
      }
    }
  }
}

function nestedGraph(bidirectional: boolean, reversed: boolean) {
  const edges = [
    { id: 'internal', fromNodeId: 'worker', toNodeId: 'screen', direction: bidirectional ? 'bidirectional' : 'one-way', label: 'Exchanges prepared data and comments with' },
    { id: 'boundary', fromNodeId: 'worker', toNodeId: 'source', direction: 'one-way', label: 'Reads the authored source' },
  ].map(edge => ({ ...edge, relationship: 'design', summary: edge.label, sourceRefs: [] }));
  return AlignmentPackSchema.parse({
    packVersion: 'routing@v1', source: { map: { id: 'routing', version: 'v1' } },
    graph: {
      groups: [
        { id: 'design:root', label: 'Design', summary: 'Design' },
        { id: 'system', parentGroupId: 'design:root', label: 'System', summary: 'System' },
        { id: 'service', parentGroupId: 'system', label: 'Service', summary: 'Service' },
      ],
      nodes: [
        { id: 'worker', groupId: 'service', label: 'Worker', summary: 'Prepares a review' },
        { id: 'screen', groupId: 'service', label: 'Screen', summary: 'Displays a review' },
        { id: 'source', groupId: 'system', label: 'Source', summary: 'Stores authored data' },
      ],
      edges: reversed ? edges.reverse() : edges,
      aggregateEdges: [],
    },
    viewState: { globalDepth: 1, expandedGroups: ['system', 'service'], semanticZoom: 'business' },
  }).graph;
}

function measuredGeometry(graph: AlignmentGraph, expanded: string[], tall: boolean) {
  const projection = projectDiagram(graph, expanded);
  return {
    nodes: Object.fromEntries(projection.nodes.map((node, index) => [node.id, {
      width: 300,
      height: node.kind === 'group' ? (tall ? 246 : 140) : (tall ? 164 + (index % 3) * 41 : 164),
    }])),
    labels: Object.fromEntries(projection.edges.map(route => [route.id, { width: 196, height: tall ? 96 : 72 }])),
  };
}

describe('compound edge routing clearance', () => {
  it.each([
    { bidirectional: false, reversed: false, tall: false },
    { bidirectional: false, reversed: true, tall: true },
    { bidirectional: true, reversed: false, tall: true },
    { bidirectional: true, reversed: true, tall: false },
  ])('separates internal and boundary design runs with $bidirectional bidirectionality, reversed=$reversed, tall=$tall', async ({ bidirectional, reversed, tall }) => {
    const graph = nestedGraph(bidirectional, reversed);
    const expanded = graph.groups.map(group => group.id);
    const diagram = await buildDiagram(graph, expanded, measuredGeometry(graph, expanded, tall));
    expectSafeRoutes(diagram, graph);
    expect(Boolean(diagram.edges.find(route => route.childEdgeIds.includes('internal'))?.bidirectional)).toBe(bidirectional);
    // These are design edges with distinct ports, not a shared legacy port stub.
    expect(parallelConflicts(diagram.edges)).toEqual([]);
  });

  it.each([
    { bidirectional: false, reversed: false, tall: false, sibling: false },
    { bidirectional: false, reversed: true, tall: true, sibling: false },
    { bidirectional: true, reversed: false, tall: true, sibling: false },
    { bidirectional: true, reversed: true, tall: false, sibling: false },
    { bidirectional: true, reversed: true, tall: true, sibling: true },
  ])('separates common-target runs with $bidirectional bidirectionality, reversed=$reversed, tall=$tall, sibling=$sibling', async ({ bidirectional, reversed, tall, sibling }) => {
    const graph = nestedGraph(bidirectional, reversed);
    graph.edges = graph.edges.map(edge => ({ ...edge, fromNodeId: edge.toNodeId, toNodeId: edge.fromNodeId }));
    if (sibling) {
      graph.groups.push({ id: 'source-service', parentGroupId: 'system', label: 'Source service', summary: 'Owns the source', sourceRefs: [] });
      graph.nodes.find(node => node.id === 'source')!.groupId = 'source-service';
    }
    const expanded = graph.groups.map(group => group.id);
    const diagram = await buildDiagram(graph, expanded, measuredGeometry(graph, expanded, tall));
    expectSafeRoutes(diagram, graph);
    expect(Boolean(diagram.edges.find(route => route.childEdgeIds.includes('internal'))?.bidirectional)).toBe(bidirectional);
    expect(parallelConflicts(diagram.edges)).toEqual([]);
  });

  it.each([false, true])('separates multiple authored boundary ingress paths with reversed declaration order=%s', async reversed => {
    const graph = designDocToPack(loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname)).graph;
    const readSource = graph.edges.find(edge => edge.id === 'read-source')!;
    [readSource.fromNodeId, readSource.toNodeId] = [readSource.toNodeId, readSource.fromNodeId];
    if (reversed) graph.edges.reverse();
    const expanded = graph.groups.map(group => group.id);
    const diagram = await buildDiagram(graph, expanded, measuredGeometry(graph, expanded, false));
    const routes = diagram.edges.filter(route => route.childEdgeIds.some(id => ['author-design', 'read-source'].includes(id)));
    expect(routes.flatMap(route => route.childEdgeIds).sort()).toEqual(['author-design', 'read-source']);
    expectSafeRoutes(diagram, graph);
    expect(parallelConflicts(diagram.edges)).toEqual([]);
  });

  it('keeps both reversed authored relationships readable with fractional measured labels and an anchor', async () => {
    const graph = designDocToPack(loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname)).graph;
    for (const edge of graph.edges.filter(edge => ['read-source', 'review-session'].includes(edge.id))) {
      [edge.fromNodeId, edge.toNodeId] = [edge.toNodeId, edge.fromNodeId];
    }
    const expanded = graph.groups.map(group => group.id);
    const measured = measuredGeometry(graph, expanded, false);
    for (const label of Object.values(measured.labels)) label.width = 202.4;
    const diagram = await buildDiagram(graph, expanded, measured);
    expectSafeRoutes(diagram, graph);
    expect(parallelConflicts(diagram.edges)).toEqual([]);
    for (const route of diagram.edges) {
      expect(route.labelBox?.lines.join(' ')).toBe(route.label);
      const label = route.labelBox!;
      const overlapsLabel = (box: Box) => overlap(label.x, label.x + label.width, box.x, box.x + box.width) > epsilon
        && overlap(label.y, label.y + label.height, box.y, box.y + box.height) > epsilon;
      for (const node of diagram.nodes) {
        expect(overlapsLabel(node.kind === 'group' ? { ...node, height: node.headerHeight! } : node), `${route.id} label overlaps ${node.id}`).toBe(false);
      }
      for (const other of diagram.edges.filter(other => other !== route)) {
        expect(overlapsLabel(other.labelBox!), `${route.id} label overlaps ${other.id} label`).toBe(false);
        for (const segment of segments(other)) expect(entersBox(segment, label), `${other.id} crosses ${route.id} label`).toBe(false);
      }
    }
    const anchor = { id: 'group:design:container:cli', x: -125.5, y: 87.25 };
    const original = diagram.nodes.find(node => node.id === anchor.id)!;
    const anchored = await buildDiagram(graph, expanded, measured, anchor);
    const dx = anchor.x - original.x;
    const dy = anchor.y - original.y;
    expect(anchored.nodes.find(node => node.id === anchor.id)).toMatchObject(anchor);
    expect(anchored.edges.map(route => route.id)).toEqual(diagram.edges.map(route => route.id));
    for (const [index, route] of anchored.edges.entries()) {
      expect(route.points).toEqual(diagram.edges[index].points.map(point => ({ x: point.x + dx, y: point.y + dy })));
    }
  });

  it.each([false, true])('separates the authored review-session and read-source paths with tall=%s', async tall => {
    const graph = designDocToPack(loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname)).graph;
    const expanded = graph.groups.map(group => group.id);
    const diagram = await buildDiagram(graph, expanded, measuredGeometry(graph, expanded, tall));
    const routes = diagram.edges.filter(route => route.childEdgeIds.some(id => ['review-session', 'read-source'].includes(id)));
    expect(routes.flatMap(route => route.childEdgeIds).sort()).toEqual(['read-source', 'review-session']);
    expect(routes.find(route => route.childEdgeIds.includes('review-session'))?.bidirectional).toBe(true);
    expectSafeRoutes(diagram, graph);
    expect(parallelConflicts(routes)).toEqual([]);
  });
});
