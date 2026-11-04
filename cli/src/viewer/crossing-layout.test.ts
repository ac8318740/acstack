import { expect, it } from 'vitest';
import type { AlignmentGraph, DiagramOrientation } from '../lib/alignment-packs.js';
import { buildDiagram, projectDiagram, type Diagram } from './alignment-graph.js';

// Synthetic planar fan-out/fan-in, with opposite declaration orders at its ends.
function fixture(nested: boolean, reversed: boolean): AlignmentGraph {
  const graph: AlignmentGraph = {
    groups: [
      { id: 'design:root', label: 'Root', summary: '', sourceRefs: [] },
      ...(nested ? [{ id: 'frame', parentGroupId: 'design:root', label: 'Frame', summary: '', sourceRefs: [] }] : []),
    ],
    nodes: ['start', 'a', 'b', 'c', 'finish'].map(id => ({
      id, groupId: nested ? 'frame' : 'design:root', label: id, summary: '', sourceRefs: [],
    })),
    edges: [['start', 'a'], ['start', 'b'], ['start', 'c'], ['c', 'finish'], ['b', 'finish'], ['a', 'finish']].map(([fromNodeId, toNodeId], index) => ({
      id: `link-${index}`, fromNodeId, toNodeId, label: 'Connects', summary: '', relationship: 'design', sourceRefs: [],
    })),
    aggregateEdges: [],
  };
  if (reversed) graph.edges.reverse();
  return graph;
}

function routeQuality(diagram: Diagram) {
  const runs = diagram.edges.map(edge => edge.points.slice(1).map((b, index) => ({ a: edge.points[index], b })));
  let crossings = 0;
  let sharedLength = 0;
  for (const [index, first] of runs.entries()) for (const second of runs.slice(index + 1)) {
    for (const a of first) for (const b of second) {
      if ((a.a.x === a.b.x) === (b.a.x === b.b.x)) {
        const along = a.a.x === a.b.x ? 'y' : 'x';
        const across = along === 'x' ? 'y' : 'x';
        if (a.a[across] === b.a[across]) sharedLength += Math.max(0,
          Math.min(Math.max(a.a[along], a.b[along]), Math.max(b.a[along], b.b[along]))
          - Math.max(Math.min(a.a[along], a.b[along]), Math.min(b.a[along], b.b[along])));
        continue;
      }
      const [v, h] = a.a.x === a.b.x ? [a, b] : [b, a];
      if (v.a.x > Math.min(h.a.x, h.b.x) && v.a.x < Math.max(h.a.x, h.b.x)
        && h.a.y > Math.min(v.a.y, v.b.y) && h.a.y < Math.max(v.a.y, v.b.y)) crossings += 1;
    }
  }
  return { crossings, sharedLength };
}

const cases = (['top-to-bottom', 'left-to-right'] as DiagramOrientation[]).flatMap(orientation =>
  [false, true].flatMap(nested => [false, true].map(reversed => ({ orientation, nested, reversed }))));
it.each(cases)('avoids unnecessary crossings and bends in $orientation, nested=$nested, reversed=$reversed', async ({ orientation, nested, reversed }) => {
  const graph = fixture(nested, reversed);
  const expanded = nested ? ['frame'] : [];
  const projected = projectDiagram(graph, expanded);
  const measured = {
    nodes: Object.fromEntries(projected.nodes.map(node => [node.id, { width: 300, height: 120 }])),
    labels: Object.fromEntries(projected.edges.map(edge => [edge.id, { width: 96, height: 28 }])),
  };
  const diagram = await buildDiagram(graph, expanded, measured, undefined, orientation);
  expect(diagram.edges.flatMap(edge => edge.childEdgeIds).sort()).toEqual(graph.edges.map(edge => edge.id).sort());
  expect(routeQuality(diagram)).toEqual({ crossings: 0, sharedLength: 0 });
  expect(diagram.edges.reduce((sum, edge) => sum + edge.points.length - 2, 0)).toBeLessThanOrEqual(12);
});
