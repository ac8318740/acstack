import type { AlignmentGraph, AlignmentNode, AlignmentPack, DiagramOrientation } from '../lib/alignment-packs.js';
import { placeDiagram, type PlacedDiagram } from './layout-place.js';
import { routeDiagram, type RoutedEdge } from './layout-route.js';

export const CARD_WIDTH = 300;
export const LABEL_WIDTH = 196;
export type Size = { width: number; height: number };
export type MeasuredGeometry = { nodes: Record<string, Size>; labels: Record<string, Size> };
const HOP_RADIUS = 5;
const CORNER_RADIUS = 6;
const LABEL_CHARS = 24;

export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };

export type DiagramNode = Box & {
  id: string;
  kind: 'item' | 'folded-group' | 'group';
  refId: string;
  ownerNodeId?: string;
  headerHeight?: number;
  label: string;
  technicalLabel?: string;
  elementKind?: string;
  channels?: string[];
  progress?: AlignmentNode['progress'];
  change?: AlignmentNode['change'];
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
  bidirectional?: boolean;
  points: Point[];
  path: string;
  labelBox?: Box & { lines: string[] };
  // No clear route existed; the arrow is drawn anyway, dashed.
  unrouted?: boolean;
};

// `bands` is how many bands each container wrapped into, kept for the next layout.
export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[]; nodeToVisible: Record<string, string>; bands?: Record<string, number> };

export function reconcileSelection(selected: string | null, diagram: Diagram, graph: AlignmentGraph): string | null {
  if (!selected || selected === 'group:design:root') return null;
  if (selected.startsWith('item:')) return diagram.nodeToVisible[selected.slice(5)] ?? null;
  if (selected.startsWith('edge:')) {
    const id = selected.slice(5);
    if (diagram.edges.some(edge => edge.childEdgeIds.includes(id))) return selected;
    const edge = graph.edges.find(edge => edge.id === id);
    return edge ? diagram.nodeToVisible[edge.fromNodeId] ?? null : null;
  }
  if (diagram.nodes.some(node => node.id === selected)) return selected;
  const group = graph.groups.find(group => `group:${group.id}` === selected);
  const descendant = graph.nodes.find(node => node.groupId === group?.id);
  return descendant ? diagram.nodeToVisible[descendant.id] ?? null : null;
}

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

// The design root is structural; the document overview belongs in the drawer.
// Collapsed groups share their owner's identity and collect only the edges they hide.
export function projectDiagram(graph: AlignmentGraph, expandedGroups: string[]): Diagram {
  const expanded = new Set(expandedGroups);
  if (graph.groups.some(group => group.id === 'design:root')) expanded.add('design:root');
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
    groupId && groupId !== 'design:root' && groups.has(groupId) ? `group:${groupId}` : undefined;

  const nodes = new Map<string, DiagramNode>();
  const blank = { x: 0, y: 0, width: CARD_WIDTH, height: 120 };
  const ownership = new Map(graph.groups.filter(group => group.ownerNodeId).map(group => [group.ownerNodeId!, group]));
  const nodeToVisible: Record<string, string> = {};
  for (const node of graph.nodes) {
    const owner = ownership.get(node.id);
    nodeToVisible[node.id] = visibleId(node.groupId, node.id) ?? `item:${node.id}`;
    if (owner && !ancestors(owner.id).some(id => !expanded.has(id))) nodeToVisible[node.id] = `group:${owner.id}`;
  }
  for (const group of graph.groups) {
    if (group.id === 'design:root') continue;
    const id = visibleId(group.id);
    if (id && id !== `group:${group.id}`) continue;
    nodes.set(`group:${group.id}`, {
      ...blank,
      id: `group:${group.id}`,
      kind: id ? 'folded-group' : 'group',
      refId: group.id,
      ownerNodeId: group.ownerNodeId,
      label: group.label,
      summary: group.summary,
      elementKind: graph.nodes.find(node => node.id === group.ownerNodeId)?.elementKind,
      channels: graph.nodes.find(node => node.id === group.ownerNodeId)?.channels,
      progress: graph.nodes.find(node => node.id === group.ownerNodeId)?.progress,
      change: graph.nodes.find(node => node.id === group.ownerNodeId)?.change,
      itemCount: graph.nodes.filter(node => node.id !== group.ownerNodeId && ancestors(node.groupId).includes(group.id)).length,
      parentId: containerOf(group.parentGroupId),
    });
  }
  for (const node of graph.nodes) {
    if (nodeToVisible[node.id] !== `item:${node.id}`) continue;
    nodes.set(`item:${node.id}`, {
      ...blank,
      id: `item:${node.id}`,
      kind: 'item',
      refId: node.id,
      label: node.label,
      technicalLabel: node.technicalLabel,
      elementKind: node.elementKind,
      channels: node.channels,
      progress: node.progress,
      change: node.change,
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
    const source = nodeToVisible[from.id];
    const target = nodeToVisible[to.id];
    if (!source || !target || source === target) continue;
    const folded = nodes.get(source)?.kind === 'folded-group' || nodes.get(target)?.kind === 'folded-group';
    const identity = edge.relationship === 'design' && !folded ? `:${edge.id}` : '';
    const key = `${source}->${target}${edge.direction === 'bidirectional' ? ':both' : ''}${identity}`;
    const existing = merged.get(key);
    if (existing) {
      existing.childEdgeIds.push(edge.id);
      existing.label = `${existing.childEdgeIds.length} links`;
      existing.summary = undefined;
      continue;
    }
    merged.set(key, {
      id: key,
      source,
      target,
      label: folded ? edge.aggregateLabel ?? edge.label : edge.label,
      summary: edge.summary,
      childEdgeIds: [edge.id],
      bidirectional: edge.direction === 'bidirectional',
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

  const depth = (node: DiagramNode): number => (node.parentId ? depth(nodes.get(node.parentId) as DiagramNode) + 1 : 0);
  return { nodes: [...nodes.values()].sort((a, b) => depth(a) - depth(b)), edges: [...merged.values()], nodeToVisible };
}

/**
 * Lays out the visible part of `graph`: containers placed inside out, then every arrow routed and
 * labelled once. Always returns a drawable diagram; an arrow no clear route exists for comes back
 * with `unrouted` set. Passing the previous layout keeps each container's band count where it still fits,
 * and the cards' order and places where they cost little room and route as cleanly as a fresh layout.
 */
export function buildDiagram(graph: AlignmentGraph, expandedGroups: string[], measured: MeasuredGeometry = { nodes: {}, labels: {} }, previous?: Diagram, orientation: DiagramOrientation = 'top-to-bottom'): Promise<Diagram> {
  // A then-callback turns any throw into a rejection the caller can handle.
  return Promise.resolve().then(() => {
    const projection = projectDiagram(graph, expandedGroups);
    const route = (placed: PlacedDiagram) => ({ ...placed, edges: routeDiagram(placed.nodes, placed.edges, measured.labels, orientation) });
    const keptPlacement = placeDiagram(projection, measured, orientation, previous);
    const kept = route(keptPlacement);
    if (!previous || !routingFlaws(kept)) return kept;
    // Keeping the previous order can leave an arrow or label nowhere clear to go; a fresh layout wins when it routes better.
    // Routing twice doubles the time, so this runs only when the fresh placement differs.
    const freshPlacement = placeDiagram(projection, measured, orientation);
    const at = (node: DiagramNode) => `${node.id}@${node.x},${node.y},${node.width},${node.height}`;
    if (freshPlacement.nodes.map(at).join() === keptPlacement.nodes.map(at).join()) return kept;
    const fresh = route(freshPlacement);
    return routingFlaws(fresh) < routingFlaws(kept) ? fresh : kept;
  });
}

// Arrows with no clear route, plus labels with no clear spot that cover a card, another label, or another arrow.
function routingFlaws({ nodes, edges }: { nodes: DiagramNode[]; edges: RoutedEdge[] }): number {
  const segments = (edge: RoutedEdge) => edge.points.slice(1).map((end, index) => {
    const start = edge.points[index];
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  });
  const covers = (label: Box, edge: RoutedEdge) => [
    ...nodes.filter(node => node.kind !== 'group'),
    ...edges.filter(other => other !== edge).flatMap(other => [...(other.labelBox ? [other.labelBox] : []), ...segments(other)]),
  ].some(box => overlaps(box, label));
  return edges.filter(edge => edge.unrouted || (edge.labelUnplaced && edge.labelBox && covers(edge.labelBox, edge))).length;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// An orthogonal route with rounded corners, a semicircle hop wherever it jumps over another edge,
// and a break where its label sits so the line never runs through text.
export function edgePath(points: Point[], hops: Point[], gap?: Box, additionalGaps: Box[] = []): string {
  if (points.length < 2) return '';
  const gaps = [...(gap ? [gap] : []), ...additionalGaps];
  const parts = [`M ${points[0].x} ${points[0].y}`];
  let previousRadius = 0;
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
    // Don't round a corner through text that either adjoining run must clip.
    if (gaps.some(box => box.x < to.x + radius && box.x + box.width > to.x - radius
      && box.y < to.y + radius && box.y + box.height > to.y - radius)) radius = 0;
    // Distance along this segment, so hops and text gaps can be drawn in order.
    const along = (point: Point) => (point.x - from.x) * dx + (point.y - from.y) * dy;
    const at = (distance: number) => `${from.x + dx * distance} ${from.y + dy * distance}`;
    const end = along(to) - radius;
    const intervals: { start: number; end: number }[] = [];
    for (const box of gaps) {
      const across = dy === 0 ? from.y : from.x;
      const [low, high] = dy === 0 ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
      if (across <= low || across >= high) continue;
      const corners = dy === 0 ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
      const [enter, exit] = corners.map(value => along(dy === 0 ? { x: value, y: from.y } : { x: from.x, y: value })).sort((a, b) => a - b);
      const start = Math.max(previousRadius, enter);
      const stop = Math.min(end, exit);
      if (stop > start) intervals.push({ start, end: stop });
    }
    const merged: typeof intervals = [];
    for (const interval of intervals.sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    const events = merged.map(interval => ({ start: interval.start, draw: `L ${at(interval.start)} M ${at(interval.end)}` }));
    if (dy === 0) {
      for (const hop of hops) {
        const distance = along(hop);
        if (hop.y !== from.y || distance - HOP_RADIUS < previousRadius || distance + HOP_RADIUS > end) continue;
        if (gaps.some(box => hop.x + HOP_RADIUS >= box.x && hop.x - HOP_RADIUS <= box.x + box.width
          && hop.y + HOP_RADIUS >= box.y && hop.y - HOP_RADIUS <= box.y + box.height)) continue;
        events.push({ start: distance - HOP_RADIUS, draw: `L ${at(distance - HOP_RADIUS)} A ${HOP_RADIUS} ${HOP_RADIUS} 0 0 ${dx > 0 ? 1 : 0} ${at(distance + HOP_RADIUS)}` });
      }
    }
    for (const event of events.sort((a, b) => a.start - b.start)) parts.push(event.draw);
    parts.push(`L ${at(end)}`);
    if (next) parts.push(`Q ${to.x} ${to.y} ${to.x + Math.sign(next.x - to.x) * radius} ${to.y + Math.sign(next.y - to.y) * radius}`);
    previousRadius = radius;
  }
  return parts.join(' ');
}

/**
 * The groups to open so an element shows as its own card or frame, and the selection id for it.
 * A container element opens its ancestors but not itself; its frame is the selection.
 */
export function revealElement(graph: AlignmentGraph, nodeId: string): { groups: string[]; selection: string } {
  const node = graph.nodes.find(item => item.id === nodeId);
  const groupOf = (id?: string) => graph.groups.find(group => group.id === id);
  const owns = Boolean(node) && groupOf(node?.groupId)?.ownerNodeId === node?.id;
  const groups: string[] = [];
  for (let id = owns ? groupOf(node?.groupId)?.parentGroupId : node?.groupId; id && id !== 'design:root'; id = groupOf(id)?.parentGroupId) groups.push(id);
  return { groups, selection: owns ? `group:${node!.groupId}` : `item:${nodeId}` };
}

// A collapsed container counts every comment it hides, on its descendants and their relationships.
export function commentsOn(node: DiagramNode, counts: Map<string, number> | undefined, diagram: Diagram, graph: AlignmentGraph): number {
  if (node.kind !== 'folded-group') return counts?.get(node.ownerNodeId ? `item:${node.ownerNodeId}` : node.id) ?? 0;
  return [...counts ?? []].reduce((sum, [id, count]) => sum + (reconcileSelection(id, diagram, graph) === node.id ? count : 0), 0);
}

/** Everything drawn: cards, arrows, and labels, which can reach past the cards. */
export function diagramBounds(diagram: Diagram): Box {
  const boxes: Box[] = [...diagram.nodes, ...diagram.edges.flatMap(edge => [...edge.points.map(point => ({ ...point, width: 0, height: 0 })), ...(edge.labelBox ? [edge.labelBox] : [])])];
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}

/** The viewport that centres `bounds` in `area` (screen pixels) at the largest zoom within [minZoom, maxZoom]. */
export function fitViewport(bounds: Box, area: Box, minZoom: number, maxZoom: number): { x: number; y: number; zoom: number } {
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(area.width / bounds.width, area.height / bounds.height)));
  return { x: area.x + (area.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: area.y + (area.height - bounds.height * zoom) / 2 - bounds.y * zoom, zoom };
}

/**
 * Where to look after revealing a blocker's element: the whole diagram when it reads at 0.75 or more,
 * otherwise the element centred at full size. `area` is the canvas part clear of the toolbar and bottom controls.
 */
export function revealViewport(target: Box, nodes: Box[], area: Box): 'fit' | { x: number; y: number; zoom: number } {
  const left = Math.min(...nodes.map(node => node.x)), top = Math.min(...nodes.map(node => node.y));
  const width = Math.max(...nodes.map(node => node.x + node.width)) - left, height = Math.max(...nodes.map(node => node.y + node.height)) - top;
  if (Math.min(area.width / width, area.height / height) >= 0.75) return 'fit';
  return { x: area.x + area.width / 2 - (target.x + target.width / 2), y: area.y + area.height / 2 - (target.y + target.height / 2), zoom: 1 };
}
