import { describe, expect, it } from 'vitest';
import { projectDiagram, type Diagram, type DiagramEdge, type DiagramNode, type MeasuredGeometry } from './alignment-graph.js';
import { layoutFixtures } from './layout-fixtures.js';
import { estimateGeometry, expandStates, orderKept } from './layout-scorecard.js';
import { placeDiagram } from './layout-place.js';

const node = (id: string, parentId?: string, kind: DiagramNode['kind'] = 'item'): DiagramNode =>
  ({ id, kind, refId: id, label: id, summary: id, parentId, x: 0, y: 0, width: 0, height: 0 });
const edge = (source: string, target: string, id = `${source}->${target}`): DiagramEdge =>
  ({ id, source, target, label: '', childEdgeIds: [], points: [], path: '' });
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[]): Diagram => ({ nodes, edges, nodeToVisible: {} });
// Cards 100 x 50, group headers 40 high; labels as given.
const measure = (nodes: DiagramNode[], labels: MeasuredGeometry['labels'] = {}): MeasuredGeometry =>
  ({ nodes: Object.fromEntries(nodes.map(item => [item.id, item.kind === 'group' ? { width: 100, height: 40 } : { width: 100, height: 50 }])), labels });
const place = (nodes: DiagramNode[], edges: DiagramEdge[], orientation: 'left-to-right' | 'top-to-bottom' = 'left-to-right', previous?: Parameters<typeof placeDiagram>[3], labels?: MeasuredGeometry['labels']) => {
  const placed = placeDiagram(diagram(nodes, edges), measure(nodes, labels), orientation, previous);
  return { ...placed, at: Object.fromEntries(placed.nodes.map(item => [item.id, item])) };
};
const chain = (count: number) => {
  const nodes = Array.from({ length: count }, (_, index) => node(`n${index}`));
  return { nodes, edges: nodes.slice(1).map((item, index) => edge(nodes[index].id, item.id)) };
};
const overlap = (a: DiagramNode, b: DiagramNode) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('placeDiagram', () => {
  it('ranks along the flow and stacks siblings across it', () => {
    const { at } = place([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('a', 'c')]);
    expect(at.b.x).toBeGreaterThan(at.a.x + at.a.width);
    expect(at.c.x).toBe(at.b.x);
    expect(at.c.y).not.toBe(at.b.y);
    const down = place([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('a', 'c')], 'top-to-bottom').at;
    expect(down.b.y).toBeGreaterThan(down.a.y + down.a.height);
    expect(down.c.y).toBe(down.b.y);
  });

  it('places an expanded group with no visible children as a box around its header', () => {
    const { at } = place([node('a'), node('empty', undefined, 'group')], [edge('a', 'empty')]);
    expect(at.empty.width).toBeGreaterThanOrEqual(100);
    expect(at.empty.height).toBeGreaterThan(40);
    expect(at.empty.x).toBeGreaterThan(at.a.x + at.a.width);
  });

  it('moves a child fed only from outside to the first rank of its group', () => {
    const nodes = [node('outside'), node('g', undefined, 'group'), node('first', 'g'), node('second', 'g'), node('entry', 'g')];
    const { at } = place(nodes, [edge('first', 'second'), edge('outside', 'entry')], 'left-to-right', { bands: { '': 1, g: 1 } });
    expect(at.entry.x).toBe(at.first.x);
    expect(at.second.x).toBeGreaterThan(at.first.x);
  });

  it('wraps a long chain into bands that snake back, so each band continues under the last', () => {
    const { nodes, edges } = chain(8);
    const { at, bands } = place(nodes, edges);
    expect(bands['']).toBeGreaterThan(1);
    const perBand = Math.ceil(8 / bands['']);
    const last = at[`n${perBand - 1}`], next = at[`n${perBand}`];
    expect(next.y).toBeGreaterThan(last.y + last.height);
    expect(next.x).toBe(last.x);
  });

  it('chooses the band count whose shape fits the screen', () => {
    const { nodes, edges } = chain(8);
    const wide = place(nodes, edges, 'left-to-right').bands[''];
    const tall = place(nodes, edges, 'top-to-bottom').bands[''];
    expect(wide).toBeGreaterThan(1);
    expect(tall).toBeGreaterThan(1);
    for (const orientation of ['left-to-right', 'top-to-bottom'] as const) {
      const placed = place(nodes, edges, orientation);
      const width = Math.max(...placed.nodes.map(item => item.x + item.width)), height = Math.max(...placed.nodes.map(item => item.y + item.height));
      expect(width / height).toBeGreaterThan(0.8);
      expect(width / height).toBeLessThan(3.2);
    }
  });

  it('keeps a previous band count while it fits within 4 times the best, and drops it beyond', () => {
    const { nodes, edges } = chain(12);
    expect(place(nodes, edges).bands['']).toBe(3);
    // Two bands fit within the slack; one band (a single long row) does not.
    expect(place(nodes, edges, 'left-to-right', { bands: { '': 2 } }).bands['']).toBe(2);
    expect(place(nodes, edges, 'left-to-right', { bands: { '': 1 } }).bands['']).toBe(3);
  });

  it('never wraps into bands of a single rank', () => {
    const { nodes, edges } = chain(3);
    expect(place(nodes, edges, 'left-to-right', { bands: { '': 3 } }).bands['']).not.toBe(3);
  });

  it('stacks the labels of links joining the same two cards in the gap between them', () => {
    const twice = [edge('a', 'b', 'first'), edge('a', 'b', 'second')];
    const at = place([node('a'), node('b')], twice, 'left-to-right', { bands: { '': 1 } }, { first: { width: 100, height: 20 }, second: { width: 120, height: 20 } }).at;
    expect(at.b.x - at.a.x - at.a.width).toBe(100 + 120 + 2 * 16);
    // A link back between the same two cards shares their stretch, so its label stacks too.
    const both = [edge('a', 'b', 'first'), edge('b', 'a', 'second')];
    const back = place([node('a'), node('b')], both, 'left-to-right', { bands: { '': 1 } }, { first: { width: 100, height: 20 }, second: { width: 120, height: 20 } }).at;
    expect(back.b.x - back.a.x - back.a.width).toBe(100 + 120 + 2 * 16);
  });

  it('widens a rank gap to fit the label leaving it and the arrows passing through it', () => {
    const plain = place([node('a'), node('b')], [edge('a', 'b')], 'left-to-right', { bands: { '': 1 } }).at;
    expect(plain.b.x - plain.a.x - plain.a.width).toBe(48);
    // Extra cards feeding b keep the layout in one band, so the gap is measured along a row.
    const fillers = ['f1', 'f2', 'f3', 'f4'].map(id => node(id));
    const feeds = fillers.map(item => edge(item.id, 'b'));
    const labelled = place([node('a'), node('b'), ...fillers], [edge('a', 'b'), ...feeds], 'left-to-right', undefined, { 'a->b': { width: 200, height: 20 } }).at;
    expect(labelled.b.x - labelled.a.x - labelled.a.width).toBe(200 + 2 * 16);
    const many = Array.from({ length: 8 }, (_, index) => edge('a', 'c', `a->c ${index}`));
    const busy = place([node('a'), node('b'), node('c'), ...fillers], [edge('a', 'b'), edge('b', 'c'), ...many, ...feeds]).at;
    // 13 arrows leave the first rank: one lane each, one spare, and 8 px clearance on both sides.
    expect(busy.b.x - busy.a.x - busy.a.width).toBe((13 + 1) * 12 + 16);
  });

  it('orders a group\'s children by where their neighbours outside the group sit', () => {
    const nodes = [node('top'), node('bottom'), node('g', undefined, 'group'), node('one', 'g'), node('two', 'g')];
    const { at } = place(nodes, [edge('top', 'two'), edge('bottom', 'one')], 'left-to-right', { bands: { '': 1, g: 1 } });
    expect(at.top.y).toBeLessThan(at.bottom.y);
    expect(at.two.y).toBeLessThan(at.one.y);
  });

  it('keeps every card\'s place across expanding and collapsing a group, making room for the group', () => {
    const outside = [node('hub'), node('side'), node('next'), node('last')];
    const links = [edge('hub', 'g'), edge('hub', 'side'), edge('g', 'next'), edge('side', 'last'), edge('hub', 'next')];
    const collapsed = [...outside, node('g')];
    const expanded = [...outside, node('g', undefined, 'group'), node('x', 'g'), node('y', 'g'), node('z', 'g')];
    for (const orientation of ['left-to-right', 'top-to-bottom'] as const) {
      const closed = place(collapsed, links, orientation);
      const opened = placeDiagram(diagram(expanded, links), measure(expanded), orientation, closed);
      const closedAgain = placeDiagram(diagram(collapsed, links), measure(collapsed), orientation, opened);
      expect(orderKept(closed, opened), orientation).toBe(1);
      expect(orderKept(opened, closedAgain), orientation).toBe(1);
    }
  });

  it('stays near a fresh layout\'s size across repeated toggles and card size changes', () => {
    // A fresh layout with the same band counts: a kept band count may legitimately change the shape.
    const extent = (nodes: DiagramNode[]) => [Math.max(...nodes.map(item => item.x + item.width)) - Math.min(...nodes.map(item => item.x)), Math.max(...nodes.map(item => item.y + item.height)) - Math.min(...nodes.map(item => item.y))];
    const steps = (label: string, views: [Diagram, MeasuredGeometry][], orientation: 'left-to-right' | 'top-to-bottom') => {
      let previous: ReturnType<typeof placeDiagram> | undefined;
      for (let step = 0; step < 16; step++) {
        const [projection, measured] = views[step % 2];
        const placed = placeDiagram(projection, measured, orientation, previous);
        const fresh = extent(placeDiagram(projection, measured, orientation, previous && { bands: previous.bands }).nodes);
        extent(placed.nodes).forEach((length, axis) => expect(length, `${label} ${orientation} step ${step} axis ${axis}`).toBeLessThanOrEqual(fresh[axis] * 1.1));
        previous = placed;
      }
    };
    for (const orientation of ['left-to-right', 'top-to-bottom'] as const) for (const [name, graph] of Object.entries(layoutFixtures)) {
      const all = graph.groups.filter(group => group.id !== 'design:root').map(group => group.id);
      const view = (expanded: string[]): [Diagram, MeasuredGeometry] => [projectDiagram(graph, expanded), estimateGeometry(graph, expanded)];
      // Expand then collapse each group, 8 times.
      for (const group of all) steps(`${name} ${group}`, [view([]), view([group])], orientation);
      // Only the card sizes change, as on zoom.
      const [projection, measured] = view(all);
      const grown = { ...measured, nodes: Object.fromEntries(Object.entries(measured.nodes).map(([id, size]) => [id, { width: size.width + 80, height: size.height + 80 }])) };
      steps(`${name} sizes`, [[projection, measured], [projection, grown]], orientation);
    }
  }, 120_000);

  it('packs a chain afresh when the previous layout wrapped it into a different band count', () => {
    const { nodes, edges } = chain(12);
    const fresh = place(nodes, edges);
    // The previous layout snaked two cards per band.
    const previous = nodes.map((item, index) => ({ ...item, width: 100, height: 50, x: (Math.floor(index / 2) % 2 ? 1 - (index % 2) : index % 2) * 148, y: Math.floor(index / 2) * 114 }));
    const again = place(nodes, edges, 'left-to-right', { nodes: previous });
    expect(Object.values(again.at).map(item => [item.x, item.y])).toEqual(Object.values(fresh.at).map(item => [item.x, item.y]));
  });

  it('sizes groups around their children with room for the header', () => {
    const nodes = [node('g', undefined, 'group'), node('a', 'g'), node('b', 'g')];
    const { at } = place(nodes, [edge('a', 'b')]);
    expect(at.g.headerHeight).toBe(40);
    for (const kid of [at.a, at.b]) {
      expect(kid.x).toBeGreaterThanOrEqual(at.g.x + 24);
      expect(kid.y).toBeGreaterThanOrEqual(at.g.y + 40 + 24);
      expect(kid.x + kid.width).toBeLessThanOrEqual(at.g.x + at.g.width - 24);
      expect(kid.y + kid.height).toBeLessThanOrEqual(at.g.y + at.g.height - 24);
    }
  });

  it('never overlaps two boxes that are not nested, on every fixture view', () => {
    for (const graph of Object.values(layoutFixtures)) {
      for (const [, expanded] of expandStates(graph)) {
        for (const orientation of ['left-to-right', 'top-to-bottom'] as const) {
          const placed = placeDiagram(projectDiagram(graph, expanded), estimateGeometry(graph, expanded), orientation);
          const byId = new Map(placed.nodes.map(item => [item.id, item]));
          const nested = (inner: DiagramNode, outer: DiagramNode) => {
            for (let parent = inner.parentId; parent; parent = byId.get(parent)?.parentId) if (parent === outer.id) return true;
            return false;
          };
          for (const [index, first] of placed.nodes.entries()) {
            for (const second of placed.nodes.slice(index + 1)) {
              if (!nested(first, second) && !nested(second, first)) expect(overlap(first, second), `${first.id} / ${second.id}`).toBe(false);
            }
          }
        }
      }
    }
  });
});
