import type { AlignmentGraph, DiagramOrientation } from '../lib/alignment-packs.js';
import { projectDiagram, wrapLabel, type Box, type Diagram, type DiagramEdge, type DiagramNode, type MeasuredGeometry, type Point } from './alignment-graph.js';
import { orderKept } from './layout-place.js';

export { orderKept };

// The scorecard decides whether a layout engine may replace another: it lays out a graph in
// every expand state and scores each result on size, empty space, bends, crossings, overlaps and time.

// `previous` is the layout shown before this one, so an engine can keep the rest of the diagram in place.
export type LayoutEngine = (graph: AlignmentGraph, expandedGroups: string[], measured: MeasuredGeometry, orientation: DiagramOrientation, previous?: Diagram) => Promise<Diagram>;

export type DiagramScore = {
  width: number;
  height: number;
  // Card area divided by the area of the box around everything drawn; higher is tighter.
  fill: number;
  // Direction changes along arrows.
  bends: number;
  // Points where two different arrows cross at a right angle.
  crossings: number;
  // Cards on cards, arrows through cards or along other arrows, and labels on cards, labels, or other arrows.
  overlaps: number;
  // Arrows drawn dashed because no clear route existed, and labels with no clear spot.
  unrouted: number;
  labelUnplaced: number;
  // Pairs of arrow ends on one card side closer than 12 px, the gap the router keeps between parallel arrows.
  crowdedPorts: number;
};

// Area judged by fit to a screen: the bounding box, scaled up by how far its aspect ratio is from 1.6.
// A wrapped chain that fits the screen beats a thin strip of smaller raw area.
export function screenArea({ width, height }: DiagramScore): number {
  const ratio = width / height;
  return width * height * Math.max(ratio / 1.6, 1.6 / ratio);
}

export type ScoreRow = { view: string; ms: number } & ({ ok: true; score: DiagramScore } | { ok: false; error: string });

// Browser-like sizes for scoring outside the browser: cards are 300 wide, labels wrap like the viewer's.
export function estimateGeometry(graph: AlignmentGraph, expandedGroups: string[]): MeasuredGeometry {
  const projection = projectDiagram(graph, expandedGroups);
  return {
    nodes: Object.fromEntries(projection.nodes.map(node => [node.id, { width: 300, height: node.kind === 'item' ? 118 : 126 }])),
    labels: Object.fromEntries(projection.edges.map(edge => {
      const lines = wrapLabel(edge.label);
      return [edge.id, { width: Math.max(...lines.map(line => line.length)) * 6.6 + 16, height: lines.length * 16 + 12 }];
    })),
  };
}

// Collapsed, the starting view, each group alone (with its ancestors), all but one, and all.
export function expandStates(graph: AlignmentGraph, initial: string[] = []): [string, string[]][] {
  const groups = graph.groups.filter(group => group.id !== 'design:root');
  const parent = new Map(groups.map(group => [group.id, group.parentGroupId]));
  const withAncestors = (id: string): string[] => {
    const chain: string[] = [];
    for (let at: string | undefined = id; at && parent.has(at); at = parent.get(at)) chain.unshift(at);
    return chain;
  };
  const all = groups.map(group => group.id);
  const states: [string, string[]][] = [['collapsed', []], ['initial', initial], ['all', all]];
  for (const id of all) states.push([`only ${id}`, withAncestors(id)], [`all but ${id}`, all.filter(other => other !== id)]);
  const seen = new Set<string>();
  return states.filter(([, expanded]) => {
    const key = [...expanded].sort().join('|');
    return !seen.has(key) && seen.add(key);
  });
}

export async function runScorecard(graph: AlignmentGraph, engine: LayoutEngine, orientation: DiagramOrientation, initial: string[] = []): Promise<ScoreRow[]> {
  const rows: ScoreRow[] = [];
  for (const [view, expanded] of expandStates(graph, initial)) {
    const started = performance.now();
    try {
      const diagram = await engine(graph, expanded, estimateGeometry(graph, expanded), orientation);
      rows.push({ view, ms: performance.now() - started, ok: true, score: scoreDiagram(diagram) });
    } catch (error) {
      rows.push({ view, ms: performance.now() - started, ok: false, error: (error as Error).message });
    }
  }
  return rows;
}

export function scoreDiagram(diagram: Diagram): DiagramScore {
  const nodes = new Map(diagram.nodes.map(node => [node.id, node]));
  const ancestors = (node: DiagramNode): Set<string> => {
    const ids = new Set<string>();
    for (let at = node.parentId; at; at = nodes.get(at)?.parentId) ids.add(at);
    return ids;
  };
  const cards = diagram.nodes.filter(node => node.kind !== 'group');
  const labels = diagram.edges.flatMap(edge => edge.labelBox ? [edge.labelBox] : []);
  const drawn: Box[] = [...diagram.nodes, ...labels, ...diagram.edges.flatMap(edge => edge.points.map(point => ({ ...point, width: 0, height: 0 })))];
  const left = Math.min(...drawn.map(box => box.x)), top = Math.min(...drawn.map(box => box.y));
  const width = Math.max(...drawn.map(box => box.x + box.width)) - left;
  const height = Math.max(...drawn.map(box => box.y + box.height)) - top;

  const segments = diagram.edges.map(edge => edge.points.slice(1).map((end, index) => [edge.points[index], end] as const));
  let bends = 0, crossings = 0, overlaps = 0;
  for (const edge of diagram.edges) {
    for (let index = 1; index < edge.points.length - 1; index++) {
      const [before, at, after] = edge.points.slice(index - 1, index + 2);
      if (!collinear(before, at, after)) bends++;
    }
  }
  for (let a = 0; a < segments.length; a++) {
    for (let b = a + 1; b < segments.length; b++) {
      for (const first of segments[a]) {
        for (const second of segments[b]) {
          if (crossesAtRightAngle(first, second)) crossings++;
          else if (runsAlong(first, second)) overlaps++;
        }
      }
    }
  }
  // Nested boxes are expected; only unrelated boxes may not touch.
  const unrelated = (a: DiagramNode, b: DiagramNode) => !ancestors(a).has(b.id) && !ancestors(b).has(a.id);
  for (let a = 0; a < diagram.nodes.length; a++) {
    for (let b = a + 1; b < diagram.nodes.length; b++) {
      if (unrelated(diagram.nodes[a], diagram.nodes[b]) && intersects(diagram.nodes[a], diagram.nodes[b])) overlaps++;
    }
  }
  diagram.edges.forEach((edge, index) => {
    for (const card of cards) {
      if (card.id === edge.source || card.id === edge.target) continue;
      if (segments[index].some(([from, to]) => intersects(segmentBox(from, to), inset(card, 2)))) overlaps++;
    }
  });
  for (const [index, label] of labels.entries()) {
    overlaps += cards.filter(card => intersects(label, card)).length;
    overlaps += labels.slice(index + 1).filter(other => intersects(label, other)).length;
  }
  // A label's background hides any other arrow under it.
  diagram.edges.forEach((edge, index) => {
    if (edge.labelBox) overlaps += segments.filter((runs, other) => other !== index && runs.some(([from, to]) => intersects(segmentBox(from, to), edge.labelBox!))).length;
  });
  const flagged = (key: 'unrouted' | 'labelUnplaced') => diagram.edges.filter(edge => (edge as DiagramEdge & { labelUnplaced?: boolean })[key]).length;
  return {
    width, height, fill: cards.reduce((sum, card) => sum + card.width * card.height, 0) / (width * height), bends, crossings, overlaps,
    unrouted: flagged('unrouted'), labelUnplaced: flagged('labelUnplaced'), crowdedPorts: crowdedPorts(diagram),
  };
}

// Arrow ends sit on a card side, or up to 2 px off it where the arrowhead stops short.
function crowdedPorts(diagram: Diagram): number {
  const nodes = new Map(diagram.nodes.map(node => [node.id, node]));
  const sides = new Map<string, number[]>();
  for (const edge of diagram.edges) {
    for (const [id, point] of [[edge.source, edge.points[0]], [edge.target, edge.points.at(-1)]] as const) {
      const box = nodes.get(id);
      if (!box || !point) continue;
      const side = ([['top', box.y - point.y], ['bottom', point.y - box.y - box.height], ['left', box.x - point.x], ['right', point.x - box.x - box.width]] as const)
        .find(([, off]) => off >= -0.5 && off <= 3)?.[0];
      if (!side) continue;
      const key = `${id}\u0000${side}`;
      sides.set(key, [...(sides.get(key) ?? []), side === 'top' || side === 'bottom' ? point.x : point.y]);
    }
  }
  let crowded = 0;
  for (const along of sides.values()) {
    along.sort((a, b) => a - b);
    crowded += along.slice(1).filter((value, index) => value - along[index] < 12).length;
  }
  return crowded;
}

function collinear(a: Point, b: Point, c: Point): boolean {
  return (b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x);
}

type Segment = readonly [Point, Point];

function crossesAtRightAngle([a, b]: Segment, [c, d]: Segment): boolean {
  const horizontal = a.y === b.y ? [a, b] : c.y === d.y ? [c, d] : undefined;
  const vertical = a.x === b.x && a.y !== b.y ? [a, b] : c.x === d.x && c.y !== d.y ? [c, d] : undefined;
  if (!horizontal || !vertical || horizontal[0] === vertical[0]) return false;
  const [h1, h2] = horizontal, [v1, v2] = vertical;
  // Strictly inside both segments, so arrows meeting at a shared card side do not count.
  return Math.min(h1.x, h2.x) < v1.x && v1.x < Math.max(h1.x, h2.x) && Math.min(v1.y, v2.y) < h1.y && h1.y < Math.max(v1.y, v2.y);
}

function runsAlong([a, b]: Segment, [c, d]: Segment): boolean {
  const shared = (lo1: number, hi1: number, lo2: number, hi2: number) => Math.min(hi1, hi2) - Math.max(lo1, lo2) > 1;
  if (a.y === b.y && c.y === d.y && a.y === c.y) return shared(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(c.x, d.x), Math.max(c.x, d.x));
  if (a.x === b.x && c.x === d.x && a.x === c.x) return shared(Math.min(a.y, b.y), Math.max(a.y, b.y), Math.min(c.y, d.y), Math.max(c.y, d.y));
  return false;
}

function segmentBox(from: Point, to: Point): Box {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}

function inset(box: Box, by: number): Box {
  return { x: box.x + by, y: box.y + by, width: box.width - 2 * by, height: box.height - 2 * by };
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Toggles every group once from fully collapsed and once from fully expanded, passing the earlier
// layout as `previous`, and reports the mean and worst share of order kept.
export async function runStability(graph: AlignmentGraph, engine: LayoutEngine, orientation: DiagramOrientation): Promise<{ mean: number; worst: number; failures: number }> {
  const groups = graph.groups.filter(group => group.id !== 'design:root');
  const parent = new Map(groups.map(group => [group.id, group.parentGroupId]));
  const all = groups.map(group => group.id);
  const layout = (expanded: string[], previous?: Diagram) => engine(graph, expanded, estimateGeometry(graph, expanded), orientation, previous).catch(() => undefined);
  const kept: number[] = [];
  let failures = 0;
  for (const from of [[], all]) {
    for (const id of all) {
      const withAncestors: string[] = [];
      for (let at: string | undefined = id; at && parent.has(at); at = parent.get(at)) withAncestors.push(at);
      const before = await layout(from);
      const after = before && await layout(from.length ? all.filter(other => other !== id) : withAncestors, before);
      if (before && after) kept.push(orderKept(before, after));
      else failures++;
    }
  }
  return { mean: kept.length ? kept.reduce((sum, share) => sum + share, 0) / kept.length : 1, worst: Math.min(1, ...kept), failures };
}

export function formatScorecard(name: string, orientation: DiagramOrientation, rows: ScoreRow[]): string {
  const lines = rows.map(row => {
    const head = `${name} ${orientation} ${row.view}`.padEnd(56);
    if (!row.ok) return `${head} FAIL ${Math.round(row.ms)} ms ${row.error.slice(0, 80)}`;
    const { width, height, fill, bends, crossings, overlaps, unrouted, labelUnplaced, crowdedPorts } = row.score;
    return `${head} ${Math.round(width)}x${Math.round(height)} ratio ${(width / height).toFixed(2)} fill ${(fill * 100).toFixed(0)}% bends ${bends} crossings ${crossings} overlaps ${overlaps} unrouted ${unrouted} labelUnplaced ${labelUnplaced} crowdedPorts ${crowdedPorts} ${Math.round(row.ms)} ms`;
  });
  const ok = rows.flatMap(row => row.ok ? [row.score] : []);
  const sum = (pick: (score: DiagramScore) => number) => ok.reduce((total, score) => total + pick(score), 0);
  lines.push(`${name} ${orientation} TOTAL area ${(sum(score => score.width * score.height) / 1e6).toFixed(1)} Mpx screen area ${(sum(screenArea) / 1e6).toFixed(1)} Mpx fill ${(sum(score => score.fill) / Math.max(1, ok.length) * 100).toFixed(0)}% bends ${sum(score => score.bends)} crossings ${sum(score => score.crossings)} overlaps ${sum(score => score.overlaps)} unrouted ${sum(score => score.unrouted)} labelUnplaced ${sum(score => score.labelUnplaced)} crowdedPorts ${sum(score => score.crowdedPorts)} failures ${rows.length - ok.length} max ${Math.round(Math.max(...rows.map(row => row.ms)))} ms`);
  return lines.join('\n');
}
