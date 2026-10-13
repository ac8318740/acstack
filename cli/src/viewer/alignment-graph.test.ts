import { describe, expect, it } from 'vitest';
import { AlignmentPackSchema } from '../lib/alignment-packs.js';
import { buildDiagram, edgePath, initialExpandedGroups, wrapLabel } from './alignment-graph.js';

const node = (id: string, groupId: string) => ({ id, groupId, label: `Item ${id}`, summary: `Summary ${id}` });
const edge = (from: string, to: string, label = `${from} feeds ${to}`) => ({
  id: `${from}-${to}`,
  fromNodeId: from,
  toNodeId: to,
  relationship: 'feeds',
  label,
  summary: label,
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

  it('wraps long labels onto short lines', () => {
    expect(wrapLabel('on success, reserve stock before charging')).toEqual(['on success, reserve', 'stock before charging']);
  });
});
