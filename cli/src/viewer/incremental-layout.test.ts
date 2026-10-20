import { describe, expect, it } from 'vitest';
import { AlignmentPackSchema } from '../lib/alignment-packs.js';
import { buildDiagram, projectDiagram, type Diagram, type MeasuredGeometry } from './alignment-graph.js';

function fixture() {
  return AlignmentPackSchema.parse({
    packVersion: 'stability@v1', source: { map: { id: 'stability', version: 'v1' } },
    graph: {
      groups: [
        { id: 'design:root', label: 'Root', summary: 'Root' },
        { id: 'a', parentGroupId: 'design:root', label: 'Workspace', summary: 'Independent workers' },
        { id: 'b', parentGroupId: 'a', label: 'Local component', summary: 'One worker' },
      ],
      nodes: ['a', 'b'].flatMap(groupId => Array.from({ length: groupId === 'a' ? 3 : 1 }, (_, i) => ({
        id: `${groupId}${i}`, groupId, label: `Worker ${i}`, summary: 'Processes data',
      }))),
      edges: [], aggregateEdges: [],
    },
    viewState: { globalDepth: 1, expandedGroups: [], semanticZoom: 'business' },
  }).graph;
}

function measured(graph: ReturnType<typeof fixture>, expanded: string[]): MeasuredGeometry {
  return {
    nodes: Object.fromEntries(projectDiagram(graph, expanded).nodes.map(node => [node.id, { width: 300, height: node.kind === 'group' ? 106 : 140 }])),
    labels: {},
  };
}

const unrelatedIds = ['item:a0', 'item:a1', 'item:a2'];
const unrelated = (diagram: Diagram) => unrelatedIds.map(id => diagram.nodes.find(node => node.id === id)!);
const order = (diagram: Diagram) => unrelated(diagram).sort((a, b) => a.x - b.x).map(node => node.id);
const displacement = (before: Diagram, after: Diagram) => unrelated(before).reduce((sum, node, index) => {
  const next = unrelated(after)[index];
  return sum + Math.hypot(next.x - node.x, next.y - node.y);
}, 0);

function expectValidGeometry(diagram: Diagram, sizes: MeasuredGeometry) {
  for (const node of diagram.nodes) {
    const size = sizes.nodes[node.id];
    if (node.kind === 'group') {
      expect(node.headerHeight, node.id).toBe(size.height);
      expect(node.width, node.id).toBeGreaterThanOrEqual(size.width);
    } else {
      expect({ width: node.width, height: node.height }, node.id).toEqual(size);
    }
    if (node.parentId) {
      const parent = diagram.nodes.find(candidate => candidate.id === node.parentId)!;
      expect(node.x, node.id).toBeGreaterThanOrEqual(parent.x);
      expect(node.y, node.id).toBeGreaterThanOrEqual(parent.y + parent.headerHeight!);
      expect(node.x + node.width, node.id).toBeLessThanOrEqual(parent.x + parent.width);
      expect(node.y + node.height, node.id).toBeLessThanOrEqual(parent.y + parent.height);
    }
    for (const sibling of diagram.nodes.filter(other => other.id !== node.id && other.parentId === node.parentId)) {
      const overlaps = Math.min(node.x + node.width, sibling.x + sibling.width) - Math.max(node.x, sibling.x) > 1e-6
        && Math.min(node.y + node.height, sibling.y + sibling.height) - Math.max(node.y, sibling.y) > 1e-6;
      expect(overlaps, `${node.id} overlaps ${sibling.id}`).toBe(false);
    }
  }
}

async function acceptedPrior(graph: ReturnType<typeof fixture>) {
  // Equivalent declaration orders produce a valid prior arrangement without prescribing a new placement policy.
  const equivalent = { ...graph, nodes: [...graph.nodes].reverse() };
  return buildDiagram(equivalent, ['a'], measured(equivalent, ['a']));
}

describe('previous accepted diagram stability', () => {
  it('preserves safe unrelated sibling order and reduces movement versus fresh local expansion', async () => {
    const graph = fixture();
    const before = await acceptedPrior(graph);
    const sizes = measured(graph, ['a', 'b']);
    const fresh = await buildDiagram(graph, ['a', 'b'], sizes);
    const incremental = await buildDiagram(graph, ['a', 'b'], sizes, undefined, before);
    expectValidGeometry(before, measured(graph, ['a']));
    expectValidGeometry(incremental, sizes);
    expect(unrelated(before).map(node => node.y)).toEqual(Array(3).fill(unrelated(before)[0].y));
    expect(unrelated(incremental).map(node => node.y)).toEqual(Array(3).fill(unrelated(incremental)[0].y));
    expect(order(fresh)).not.toEqual(order(before));
    expect(order(incremental)).toEqual(order(before));
    expect(displacement(before, incremental)).toBeLessThan(displacement(before, fresh));
  });

  it('uses current measurements rather than previous sizes without mutating any input', async () => {
    const graph = fixture();
    const previous = await acceptedPrior(graph);
    const expanded = ['a', 'b'];
    const sizes = measured(graph, expanded);
    sizes.nodes['item:a0'] = { width: 348, height: 193 };
    sizes.nodes['item:b0'] = { width: 326, height: 181 };
    sizes.nodes['group:a'] = { width: 370, height: 159 };
    sizes.nodes['group:b'] = { width: 354, height: 147 };
    const snapshot = structuredClone({ graph, previous, expanded, sizes });
    const next = await buildDiagram(graph, expanded, sizes, undefined, previous);
    expectValidGeometry(next, sizes);
    expect(next.nodes.find(node => node.id === 'item:a0')).toMatchObject({ width: 348, height: 193 });
    expect(next.nodes.find(node => node.id === 'item:b0')).toMatchObject({ width: 326, height: 181 });
    expect(next.nodes.find(node => node.id === 'group:a')?.headerHeight).toBe(159);
    expect(next.nodes.find(node => node.id === 'group:b')?.headerHeight).toBe(147);
    expect({ graph, previous, expanded, sizes }).toEqual(snapshot);
  });

  it('does not accumulate unrelated sibling drift over repeated anchored expand-collapse cycles', async () => {
    const graph = fixture();
    const initial = await acceptedPrior(graph);
    const container = initial.nodes.find(node => node.id === 'group:a')!;
    const anchor = { id: container.id, x: container.x, y: container.y };
    let previous = initial;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const expanded of [['a', 'b'], ['a']]) {
        const sizes = measured(graph, expanded);
        previous = await buildDiagram(graph, expanded, sizes, anchor, previous);
        expectValidGeometry(previous, sizes);
        expect(order(previous)).toEqual(order(initial));
        expect(previous.nodes.find(node => node.id === anchor.id)).toMatchObject(anchor);
      }
      for (const [index, node] of unrelated(previous).entries()) {
        expect(node.x, `${node.id} x drift after cycle ${cycle + 1}`).toBeCloseTo(unrelated(initial)[index].x, 6);
        expect(node.y, `${node.id} y drift after cycle ${cycle + 1}`).toBeCloseTo(unrelated(initial)[index].y, 6);
      }
    }
  });
});
