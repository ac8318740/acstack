import { describe, expect, it } from 'vitest';
import type { DiagramOrientation } from '../lib/alignment-packs.js';
import { buildDiagram, projectDiagram, type Diagram, type DiagramEdge, type DiagramNode, type Point } from './alignment-graph.js';
import { layoutFixtures, stressGraphs } from './layout-fixtures.js';
import { estimateGeometry, expandStates, formatScorecard, orderKept, runScorecard, runStability, scoreDiagram, screenArea, type LayoutEngine } from './layout-scorecard.js';

const card = (id: string, x: number, y: number, extra: Partial<DiagramNode> = {}): DiagramNode =>
  ({ id, kind: 'item', refId: id, label: id, summary: id, x, y, width: 100, height: 50, ...extra });
const arrow = (source: string, target: string, points: Point[], extra: Partial<DiagramEdge> = {}): DiagramEdge =>
  ({ id: `${source}->${target}`, source, target, label: '', childEdgeIds: [], points, path: '', ...extra });
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[]): Diagram => ({ nodes, edges, nodeToVisible: {} });

describe('scoreDiagram', () => {
  it('measures the box around everything drawn and the share of it covered by cards', () => {
    const score = scoreDiagram(diagram([card('a', 0, 0), card('b', 300, 0)], [arrow('a', 'b', [{ x: 100, y: 25 }, { x: 300, y: 25 }])]));
    expect(score).toMatchObject({ width: 400, height: 50, bends: 0, crossings: 0, overlaps: 0 });
    expect(score.fill).toBeCloseTo(0.5);
  });

  it('counts direction changes, not route points', () => {
    const route = [{ x: 100, y: 25 }, { x: 150, y: 25 }, { x: 200, y: 25 }, { x: 200, y: 225 }, { x: 300, y: 225 }];
    expect(scoreDiagram(diagram([card('a', 0, 0), card('b', 300, 200)], [arrow('a', 'b', route)])).bends).toBe(2);
  });

  it('counts arrows crossing, but not arrows meeting at an end', () => {
    const nodes = [card('a', 0, 100), card('b', 400, 100), card('c', 200, 0), card('d', 200, 300)];
    const across = arrow('a', 'b', [{ x: 100, y: 125 }, { x: 400, y: 125 }]);
    const down = arrow('c', 'd', [{ x: 250, y: 50 }, { x: 250, y: 300 }]);
    const touching = arrow('c', 'a', [{ x: 210, y: 50 }, { x: 210, y: 90 }, { x: 100, y: 90 }]);
    expect(scoreDiagram(diagram(nodes, [across, down])).crossings).toBe(1);
    expect(scoreDiagram(diagram(nodes, [across, touching])).crossings).toBe(0);
  });

  it('counts cards on cards, arrows through cards or along arrows, and labels on cards or labels', () => {
    const label = { x: 0, y: 0, width: 50, height: 20, lines: [] };
    expect(scoreDiagram(diagram([card('a', 0, 0), card('b', 50, 0)], [])).overlaps).toBe(1);
    expect(scoreDiagram(diagram([card('a', 0, 0), card('b', 400, 0), card('c', 200, 0)], [arrow('a', 'b', [{ x: 100, y: 25 }, { x: 400, y: 25 }])])).overlaps).toBe(1);
    const nodes = [card('a', 0, 0), card('b', 400, 0)];
    const twin = [{ x: 100, y: 25 }, { x: 400, y: 25 }];
    expect(scoreDiagram(diagram(nodes, [arrow('a', 'b', twin), arrow('b', 'a', twin)])).overlaps).toBe(1);
    expect(scoreDiagram(diagram(nodes, [arrow('a', 'b', twin, { labelBox: { ...label, x: 80 } })])).overlaps).toBe(1);
    expect(scoreDiagram(diagram(nodes, [arrow('a', 'b', twin, { labelBox: { ...label, x: 200 } }), arrow('b', 'a', [{ x: 400, y: 40 }, { x: 100, y: 40 }], { labelBox: { ...label, x: 220 } })])).overlaps).toBe(1);
  });

  it('lets cards sit inside their own containers', () => {
    const group = card('g', 0, 0, { kind: 'group', width: 400, height: 300 });
    expect(scoreDiagram(diagram([group, card('a', 20, 60, { parentId: 'g' })], [])).overlaps).toBe(0);
  });
});

describe('screenArea', () => {
  it('keeps the raw area at a 1.6 aspect ratio and penalises strips', () => {
    const score = { fill: 1, bends: 0, crossings: 0, overlaps: 0, unrouted: 0, labelUnplaced: 0, crowdedPorts: 0 };
    expect(screenArea({ ...score, width: 160, height: 100 })).toBeCloseTo(16000);
    expect(screenArea({ ...score, width: 640, height: 100 })).toBeCloseTo(64000 * 4);
    expect(screenArea({ ...score, width: 100, height: 160 })).toBeCloseTo(16000 * 2.56);
  });
});

describe('orderKept', () => {
  it('counts pairs that keep their sides, treating near-level centres as level', () => {
    const before = diagram([card('a', 0, 0), card('b', 300, 0), card('c', 600, 0)], []);
    expect(orderKept(before, diagram([card('a', 0, 20), card('b', 300, 0), card('c', 600, 0)], []))).toBe(1);
    expect(orderKept(before, diagram([card('a', 0, 0), card('b', 300, 0), card('c', 0, 200)], []))).toBeCloseTo(1 / 3);
  });

  it('ignores cards that appear in only one layout', () => {
    expect(orderKept(diagram([card('a', 0, 0), card('b', 300, 0)], []), diagram([card('a', 0, 0), card('b', 300, 0), card('new', 0, 300)], []))).toBe(1);
  });
});

describe('expandStates', () => {
  it('opens each group with its ancestors and skips repeated views', () => {
    const states = expandStates(layoutFixtures['deep nesting']);
    const views = Object.fromEntries(states);
    expect(views['only design:container:middle']).toEqual(['design:container:outer', 'design:container:middle']);
    const keys = states.map(([, expanded]) => [...expanded].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('layout fixtures', () => {
  it('project to diagrams with every connection visible when fully expanded', () => {
    for (const graph of Object.values(layoutFixtures)) {
      const all = graph.groups.map(group => group.id);
      expect(projectDiagram(graph, all).edges).toHaveLength(graph.edges.length);
    }
  });
});

const orientations: DiagramOrientation[] = ['left-to-right', 'top-to-bottom'];

describe('layout quality', () => {
  it('lays out every fixture view with nothing overlapping, every arrow routed, and ports apart', async () => {
    for (const orientation of orientations) for (const [name, graph] of Object.entries(layoutFixtures)) {
      for (const [view, expanded] of expandStates(graph)) {
        const score = scoreDiagram(await buildDiagram(graph, expanded, estimateGeometry(graph, expanded), undefined, orientation));
        expect({ overlaps: score.overlaps, unrouted: score.unrouted, crowdedPorts: score.crowdedPorts }, `${name} ${orientation} ${view}`)
          .toEqual({ overlaps: 0, unrouted: 0, crowdedPorts: 0 });
      }
    }
  }, 120_000);

  it('keeps that quality when a view is laid out with another view as the previous layout', async () => {
    for (const orientation of orientations) for (const [name, graph] of Object.entries(layoutFixtures)) {
      const states = expandStates(graph);
      // Every third pair of views, which keeps the run short and still covers every kind of transition.
      for (const [from, [fromView, fromExpanded]] of states.entries()) {
        const previous = await buildDiagram(graph, fromExpanded, estimateGeometry(graph, fromExpanded), undefined, orientation);
        for (const [to, [view, expanded]] of states.entries()) {
          if ((from + to) % 3) continue;
          const score = scoreDiagram(await buildDiagram(graph, expanded, estimateGeometry(graph, expanded), previous, orientation));
          expect({ overlaps: score.overlaps, unrouted: score.unrouted, crowdedPorts: score.crowdedPorts }, `${name} ${orientation} ${fromView} to ${view}`)
            .toEqual({ overlaps: 0, unrouted: 0, crowdedPorts: 0 });
        }
      }
    }
  }, 180_000);

  it('spreads a star wider than one card side over other sides without failures', async () => {
    for (const orientation of orientations) for (const name of ['star10', 'star12', 'star24', 'star40']) {
      const graph = stressGraphs[name];
      const score = scoreDiagram(await buildDiagram(graph, [], estimateGeometry(graph, []), undefined, orientation));
      expect({ overlaps: score.overlaps, unrouted: score.unrouted, crowdedPorts: score.crowdedPorts }, `${name} ${orientation}`)
        .toEqual({ overlaps: 0, unrouted: 0, crowdedPorts: 0 });
    }
  }, 60_000);

  it('keeps dense graphs within the time budget, degrading instead of throwing', async () => {
    for (const orientation of orientations) for (const graph of Object.values(stressGraphs)) {
      const measured = estimateGeometry(graph, []);
      await buildDiagram(graph, [], measured, undefined, orientation);
      const started = performance.now();
      const diagram = await buildDiagram(graph, [], measured, undefined, orientation);
      // Far above the 300 ms target: the vmThreads test pool runs several times slower, and a busy CI machine slower still.
      // Unbudgeted routing took tens of seconds here, so this still catches a lost budget.
      expect(performance.now() - started).toBeLessThan(10_000);
      expect(diagram.edges.every(edge => edge.points.length >= 2)).toBe(true);
    }
  }, 60_000);
});

const engines: Record<string, LayoutEngine> = {
  current: (graph, expanded, measured, orientation, previous) => buildDiagram(graph, expanded, measured, previous, orientation),
};

// Report run: LAYOUT_SCORECARD=1 prints every fixture's scores. LAYOUT_SCORECARD_DOC=<project folder>#<map>
// also scores a design doc kept outside the repository, so private docs never become fixtures.
describe.runIf(process.env.LAYOUT_SCORECARD)('layout scorecard report', () => {
  it('scores every fixture in every expand state', async () => {
    const graphs = { ...layoutFixtures };
    if (process.env.LAYOUT_SCORECARD_DOC) {
      const [root, map] = process.env.LAYOUT_SCORECARD_DOC.split('#');
      const { loadMapDesign } = await import('../lib/design-lifecycle.js');
      const { designDocToPack } = await import('../lib/design-doc.js');
      graphs['outside doc'] = designDocToPack(loadMapDesign(root, map).doc).graph;
    }
    for (const [engine, layout] of Object.entries(engines)) {
      for (const orientation of orientations) {
        for (const [name, graph] of Object.entries(graphs)) {
          console.log(formatScorecard(`${engine} ${name}`, orientation, await runScorecard(graph, layout, orientation)));
          const { mean, worst, failures } = await runStability(graph, layout, orientation);
          console.log(`${engine} ${name} ${orientation} STABILITY order kept ${(mean * 100).toFixed(0)}% worst toggle ${(worst * 100).toFixed(0)}% failed toggles ${failures}`);
        }
      }
    }
  }, 600_000);
});
