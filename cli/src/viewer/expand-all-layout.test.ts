import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { designDocToPack } from '../lib/design-doc.js';
import { EX, exampleDesign } from '../example-design.js';
import { buildDiagram, type HeaderMeasurer, type MeasuredGeometry } from './alignment-graph.js';

// Real Chrome measurements of the worked example at 1920x1080, with headers in the order the layout asked for them.
const measured = JSON.parse(readFileSync(new URL('./__tests__/fixtures/expand-all-measured.json', import.meta.url), 'utf8')) as { geometry: MeasuredGeometry; headers: ReturnType<HeaderMeasurer>[] };
const replay = (): HeaderMeasurer => { let call = 0; return () => measured.headers[Math.min(call++, measured.headers.length - 1)]; };
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('expanding every group of the worked example with measured sizes', () => {
  it('lays out, and slides the review-session label off-centre to clear the neighbouring route', async () => {
    const graph = designDocToPack(exampleDesign()).graph;
    const diagram = await buildDiagram(graph, graph.groups.map(group => group.id), measured.geometry, undefined, 'top-to-bottom', replay());
    expect(diagram.edges).toHaveLength(6);
    const session = diagram.edges.find(edge => edge.childEdgeIds.includes(`${EX['review-runtime']}-${EX.viewer}`))!;
    const box = session.labelBox!;
    // Its own run still passes through the label, so the line breaks under the text.
    const runs = session.points.slice(1).map((end, index) => [session.points[index], end] as const);
    expect(runs.some(([a, b]) => a.x === b.x && a.x > box.x && a.x < box.x + box.width && Math.min(a.y, b.y) <= box.y && Math.max(a.y, b.y) >= box.y + box.height)).toBe(true);
    for (const other of diagram.edges.filter(edge => edge !== session)) {
      expect(overlaps(box, other.labelBox!)).toBe(false);
      for (const [a, b] of other.points.slice(1).map((end, index) => [other.points[index], end] as const)) {
        const segment = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x) || 1, height: Math.abs(b.y - a.y) || 1 };
        expect(overlaps(box, segment), `${other.label} crosses the review-session label`).toBe(false);
      }
    }
    for (const card of diagram.nodes.filter(node => node.kind !== 'group')) expect(overlaps(box, card)).toBe(false);
  });

  it('lays out every reachable expand state', async () => {
    const graph = designDocToPack(exampleDesign()).graph;
    const states = [['design:root'], ['design:root', `design:container:${EX.acstack}`], graph.groups.map(group => group.id)];
    for (const expanded of states) {
      const diagram = await buildDiagram(graph, expanded, measured.geometry, undefined, 'top-to-bottom', replay());
      expect(diagram.edges.length, expanded.join(', ')).toBeGreaterThan(0);
    }
  });
});

describe('revealing an element from a blocker', () => {
  it('opens every container above an element, and only the ancestors of a container element', async () => {
    const { revealElement } = await import('./alignment-graph.js');
    const graph = designDocToPack(exampleDesign()).graph;
    // Browser review interface sits in CLI package, which sits in ACStack plugin.
    expect(revealElement(graph, EX.viewer)).toEqual({ groups: [`design:container:${EX.cli}`, `design:container:${EX.acstack}`], selection: `item:${EX.viewer}` });
    // CLI package is itself a container: open its parent and select its frame.
    expect(revealElement(graph, EX.cli)).toEqual({ groups: [`design:container:${EX.acstack}`], selection: `group:design:container:${EX.cli}` });
    expect(revealElement(graph, EX.github)).toEqual({ groups: [], selection: `item:${EX.github}` });
  });
});

describe('comment counts on a collapsed container', () => {
  it('totals the comments on everything the container hides', async () => {
    const { commentsOn } = await import('./alignment-graph.js');
    const graph = designDocToPack(exampleDesign()).graph;
    const diagram = await buildDiagram(graph, [], measured.geometry, undefined, 'top-to-bottom', replay());
    const plugin = diagram.nodes.find(node => node.id === `group:design:container:${EX.acstack}`)!;
    const github = diagram.nodes.find(node => node.id === `item:${EX.github}`)!;
    const counts = new Map([[`item:${EX.viewer}`, 2], [`item:${EX.skills}`, 1], [`item:${EX.github}`, 4]]);
    expect(plugin.kind).toBe('folded-group');
    expect(commentsOn(plugin, counts, diagram, graph)).toBe(3);
    expect(commentsOn(github, counts, diagram, graph)).toBe(4);
  });
});
