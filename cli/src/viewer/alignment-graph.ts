import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { AlignmentGraph, AlignmentPack } from '../lib/alignment-packs.js';

const NODE_WIDTH = 240;
export const NODE_HEIGHT = 84;
const HOP_RADIUS = 5;
const CORNER_RADIUS = 6;
const ARROW_INSET = 2;
const LABEL_CHARS = 24;

export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };

export type DiagramNode = Box & {
  id: string;
  kind: 'item' | 'folded-group' | 'group';
  refId: string;
  label: string;
  technicalLabel?: string;
  summary: string;
  itemCount?: number;
  parentId?: string;
};

export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  summary?: string;
  childEdgeIds: string[];
  points: Point[];
  path: string;
  labelBox?: Box & { lines: string[] };
};

export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[] };

export function initialExpandedGroups(pack: AlignmentPack): string[] {
  const depthOf = (id: string): number => {
    const parent = pack.graph.groups.find(group => group.id === id)?.parentGroupId;
    return parent ? depthOf(parent) + 1 : 0;
  };
  return pack.graph.groups
    .filter(group => depthOf(group.id) < pack.viewState.globalDepth || pack.viewState.expandedGroups.includes(group.id))
    .map(group => group.id);
}

export function wrapLabel(text: string, max = LABEL_CHARS): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + word.length + 1 <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

// Folds collapsed groups into single boxes, merges the edges they hide, and lays out what is left.
export async function buildDiagram(graph: AlignmentGraph, expandedGroups: string[], nodeHeight = NODE_HEIGHT): Promise<Diagram> {
  const expanded = new Set(expandedGroups);
  const groups = new Map(graph.groups.map(group => [group.id, group]));
  const ancestors = (groupId: string): string[] => {
    const chain: string[] = [];
    for (let id: string | undefined = groupId; id && groups.has(id); id = groups.get(id)?.parentGroupId) chain.unshift(id);
    return chain;
  };
  // The outermost collapsed ancestor swallows everything beneath it.
  const visibleId = (groupId: string, itemId?: string): string | undefined => {
    const folded = ancestors(groupId).find(id => !expanded.has(id));
    return folded ? `group:${folded}` : itemId && `item:${itemId}`;
  };
  const containerOf = (groupId: string | undefined): string | undefined =>
    groupId && groups.has(groupId) ? `group:${groupId}` : undefined;

  const nodes = new Map<string, DiagramNode>();
  const blank = { x: 0, y: 0, width: NODE_WIDTH, height: nodeHeight };
  for (const group of graph.groups) {
    const id = visibleId(group.id);
    if (id && id !== `group:${group.id}`) continue;
    nodes.set(`group:${group.id}`, {
      ...blank,
      id: `group:${group.id}`,
      kind: id ? 'folded-group' : 'group',
      refId: group.id,
      label: group.label,
      summary: group.summary,
      itemCount: graph.nodes.filter(node => ancestors(node.groupId).includes(group.id)).length,
      parentId: containerOf(group.parentGroupId),
    });
  }
  for (const node of graph.nodes) {
    if (visibleId(node.groupId, node.id) !== `item:${node.id}`) continue;
    nodes.set(`item:${node.id}`, {
      ...blank,
      id: `item:${node.id}`,
      kind: 'item',
      refId: node.id,
      label: node.label,
      technicalLabel: node.technicalLabel,
      summary: node.summary,
      parentId: containerOf(node.groupId),
    });
  }

  const merged = new Map<string, DiagramEdge>();
  const graphNodes = new Map(graph.nodes.map(node => [node.id, node]));
  for (const edge of graph.edges) {
    const from = graphNodes.get(edge.fromNodeId);
    const to = graphNodes.get(edge.toNodeId);
    if (!from || !to) continue;
    const source = visibleId(from.groupId, from.id);
    const target = visibleId(to.groupId, to.id);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    const existing = merged.get(key);
    if (existing) {
      existing.childEdgeIds.push(edge.id);
      existing.label = `${existing.childEdgeIds.length} links`;
      existing.summary = undefined;
      continue;
    }
    const folded = source.startsWith('group:') || target.startsWith('group:');
    merged.set(key, {
      id: key,
      source,
      target,
      label: folded ? edge.aggregateLabel ?? edge.label : edge.label,
      summary: edge.summary,
      childEdgeIds: [edge.id],
      points: [],
      path: '',
    });
  }
  for (const edge of merged.values()) {
    const declared = graph.aggregateEdges.find(
      aggregate => edge.source === `group:${aggregate.fromGroupId}` && edge.target === `group:${aggregate.toGroupId}`
    );
    if (declared?.label) edge.label = declared.label;
    if (declared?.summary) edge.summary = declared.summary;
  }

  const edges = [...merged.values()];
  await layout([...nodes.values()], edges);
  for (const edge of edges) edge.path = edgePath(edge.points, crossings(edge, edges), edge.labelBox);
  const depth = (node: DiagramNode): number => (node.parentId ? depth(nodes.get(node.parentId) as DiagramNode) + 1 : 0);
  // React Flow needs a parent listed before its children.
  return { nodes: [...nodes.values()].sort((a, b) => depth(a) - depth(b)), edges };
}

async function layout(nodes: DiagramNode[], edges: DiagramEdge[]): Promise<void> {
  const toElk = (node: DiagramNode): ElkNode =>
    node.kind === 'group'
      ? {
          id: node.id,
          layoutOptions: { 'elk.padding': '[top=52,left=24,bottom=24,right=24]' },
          children: nodes.filter(child => child.parentId === node.id).map(toElk),
        }
      : { id: node.id, width: node.width, height: node.height };
  const elkEdges: ElkExtendedEdge[] = edges.map(edge => {
    const lines = wrapLabel(edge.label);
    const width = Math.max(0, ...lines.map(line => line.length)) * 6.6 + 16;
    return { id: edge.id, sources: [edge.source], targets: [edge.target], labels: [{ text: edge.label, width, height: lines.length * 16 + 8 }] };
  });
  const result = await new ELK.default().layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.edgeLabels.inline': 'true',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.spacing.nodeNode': '48',
      'elk.spacing.edgeEdge': '20',
      'elk.spacing.edgeLabel': '6',
    },
    children: nodes.filter(node => !node.parentId).map(toElk),
    edges: elkEdges,
  });

  // ELK reports positions relative to the parent and edge geometry relative to the edge's container.
  const origin = new Map<string, Point>([['root', { x: 0, y: 0 }]]);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const walk = (elkNode: ElkNode, offset: Point): void => {
    for (const child of elkNode.children ?? []) {
      const abs = { x: offset.x + (child.x ?? 0), y: offset.y + (child.y ?? 0) };
      origin.set(child.id, abs);
      Object.assign(byId.get(child.id) as DiagramNode, abs, { width: child.width ?? NODE_WIDTH, height: child.height ?? NODE_HEIGHT });
      walk(child, abs);
    }
  };
  walk(result, { x: 0, y: 0 });
  const laidOut = new Map((result.edges ?? []).map((edge: ElkExtendedEdge) => [edge.id, edge]));
  for (const edge of edges) {
    const out = laidOut.get(edge.id) as ElkExtendedEdge & { container?: string };
    const offset = origin.get(out.container ?? 'root') ?? { x: 0, y: 0 };
    // Rounding drops ELK's float noise, so straight runs compare as exactly horizontal or vertical.
    const shift = (point: Point): Point => ({ x: Math.round((point.x + offset.x) * 10) / 10, y: Math.round((point.y + offset.y) * 10) / 10 });
    const section = out.sections?.[0];
    if (section) edge.points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(shift);
    // Stop just short of the box so the arrow tip touches the border instead of piercing it.
    const [beforeEnd, last] = edge.points.slice(-2);
    if (last && beforeEnd) {
      if (last.x === beforeEnd.x) last.y -= Math.sign(last.y - beforeEnd.y) * ARROW_INSET;
      else last.x -= Math.sign(last.x - beforeEnd.x) * ARROW_INSET;
    }
    const label = out.labels?.[0];
    if (label) edge.labelBox = { x: 0, y: 0, width: label.width ?? 0, height: label.height ?? 0, lines: wrapLabel(edge.label) };
  }
  placeLabels(nodes, edges);
}

// ELK misplaces labels on edges that cross group borders, so each label tries spots along its own straight runs,
// longest first, and takes the first that clears every box, group header, and earlier label.
function placeLabels(nodes: DiagramNode[], edges: DiagramEdge[]): void {
  const pad = 4;
  const taken: Box[] = nodes.map(node => (node.kind === 'group' ? { ...node, height: 44 } : node));
  const clear = (box: Box) =>
    taken.every(other => box.x + box.width + pad <= other.x || other.x + other.width + pad <= box.x || box.y + box.height + pad <= other.y || other.y + other.height + pad <= box.y);
  for (const edge of edges) {
    const label = edge.labelBox;
    if (!label || edge.points.length < 2) continue;
    const runs = edge.points
      .slice(1)
      .map((end, index) => [edge.points[index], end] as const)
      .sort(([a, b], [c, d]) => Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y));
    // A spot must sit wholly inside one straight run, clear of its rounded corners, or the line cannot break around it.
    const spots = runs.flatMap(([a, b]) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const half = (a.y === b.y ? label.width : label.height) / 2 + CORNER_RADIUS + 2;
      if (length < half * 2) return [];
      return [0.5, 0.3, 0.7, 0.15, 0.85].map(t => {
        const along = Math.min(Math.max(length * t, half), length - half) / length;
        return { x: a.x + (b.x - a.x) * along - label.width / 2, y: a.y + (b.y - a.y) * along - label.height / 2, width: label.width, height: label.height };
      });
    });
    const [a, b] = runs[0];
    const middle = { x: (a.x + b.x - label.width) / 2, y: (a.y + b.y - label.height) / 2, width: label.width, height: label.height };
    Object.assign(label, spots.find(clear) ?? spots[0] ?? middle);
    taken.push(label);
  }
}

// Points where a vertical segment of another edge crosses this edge's horizontal segments.
function crossings(edge: DiagramEdge, edges: DiagramEdge[]): Point[] {
  const segments = (points: Point[]) => points.slice(1).map((end, index) => [points[index], end] as const);
  const clear = HOP_RADIUS + 1;
  const hits: Point[] = [];
  for (const [a, b] of segments(edge.points)) {
    if (a.y !== b.y) continue;
    const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    for (const other of edges) {
      if (other === edge) continue;
      for (const [c, d] of segments(other.points)) {
        if (c.x !== d.x) continue;
        const [top, bottom] = [Math.min(c.y, d.y), Math.max(c.y, d.y)];
        if (c.x > left + clear && c.x < right - clear && a.y > top + 1 && a.y < bottom - 1) hits.push({ x: c.x, y: a.y });
      }
    }
  }
  return hits;
}

// An orthogonal route with rounded corners, a semicircle hop wherever it jumps over another edge,
// and a break where its label sits so the line never runs through text.
export function edgePath(points: Point[], hops: Point[], gap?: Box): string {
  if (points.length < 2) return '';
  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length; index += 1) {
    const [from, to] = [points[index - 1], points[index]];
    const next = points[index + 1];
    // Routes are orthogonal: a segment moves along one axis only.
    const vertical = to.x === from.x;
    const dx = vertical ? 0 : Math.sign(to.x - from.x);
    const dy = vertical ? Math.sign(to.y - from.y) : 0;
    let radius = 0;
    if (next) {
      // A hop right beside a corner wins; the corner rounds less to make room.
      const hopGap = Math.min(...hops.filter(hop => hop.y === to.y).map(hop => Math.abs(hop.x - to.x) - HOP_RADIUS));
      radius = Math.max(0, Math.min(CORNER_RADIUS, Math.hypot(to.x - from.x, to.y - from.y) / 2, Math.hypot(next.x - to.x, next.y - to.y) / 2, hopGap));
    }
    // Distance along this segment, so hops and the label gap can be drawn in order.
    const along = (point: Point) => (point.x - from.x) * dx + (point.y - from.y) * dy;
    const at = (distance: number) => `${from.x + dx * distance} ${from.y + dy * distance}`;
    const end = along(to) - radius;
    const events: { start: number; draw: string }[] = [];
    if (dy === 0) {
      for (const hop of hops) {
        const distance = along(hop);
        if (hop.y !== from.y || distance <= 0 || distance >= along(to)) continue;
        events.push({ start: distance - HOP_RADIUS, draw: `L ${at(distance - HOP_RADIUS)} A ${HOP_RADIUS} ${HOP_RADIUS} 0 0 ${dx > 0 ? 1 : 0} ${at(distance + HOP_RADIUS)}` });
      }
    }
    if (gap) {
      const across = dy === 0 ? from.y : from.x;
      const [low, high] = dy === 0 ? [gap.y, gap.y + gap.height] : [gap.x, gap.x + gap.width];
      const corners = dy === 0 ? [gap.x, gap.x + gap.width] : [gap.y, gap.y + gap.height];
      const [enter, exit] = corners.map(value => along(dy === 0 ? { x: value, y: from.y } : { x: from.x, y: value })).sort((a, b) => a - b);
      if (across > low && across < high && enter > 0 && exit < end) events.push({ start: enter, draw: `L ${at(enter)} M ${at(exit)}` });
    }
    for (const event of events.sort((a, b) => a.start - b.start)) parts.push(event.draw);
    parts.push(`L ${at(end)}`);
    if (next) parts.push(`Q ${to.x} ${to.y} ${to.x + Math.sign(next.x - to.x) * radius} ${to.y + Math.sign(next.y - to.y) * radius}`);
  }
  return parts.join(' ');
}
