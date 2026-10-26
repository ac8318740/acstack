import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { AlignmentGraph, AlignmentPack, DiagramOrientation } from '../lib/alignment-packs.js';

export const CARD_WIDTH = 300;
export const LABEL_WIDTH = 196;
export type Size = { width: number; height: number };
export type MeasuredGeometry = { nodes: Record<string, Size>; labels: Record<string, Size> };
const HOP_RADIUS = 5;
const CORNER_RADIUS = 6;
const ARROW_INSET = 2;
const LABEL_CHARS = 24;
const EDGE_SPACING = 80;
const COMPACT_EDGE_SPACING = 24;
const ROUTE_CLEARANCE = 12;

export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };
export type HeaderGeometry = { width: number; hardObstacles: Box[]; subtitleLines: Box[] };
export type HeaderMeasurer = (nodes: readonly DiagramNode[]) => Record<string, HeaderGeometry>;

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
};

export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[]; nodeToVisible: Record<string, string> };

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

export async function buildDiagram(graph: AlignmentGraph, expandedGroups: string[], measured?: MeasuredGeometry, previous?: Diagram, orientation?: DiagramOrientation, measureHeaders?: HeaderMeasurer): Promise<Diagram> {
  const diagram = projectDiagram(graph, expandedGroups);
  for (const node of diagram.nodes) {
    const size = measured?.nodes[node.id];
    if (size) Object.assign(node, size);
    node.headerHeight = node.height;
  }
  const design = graph.groups.some(group => group.id === 'design:root');
  const horizontal = design && orientation === 'left-to-right';
  let headers: Record<string, HeaderGeometry> = {};
  let unresolved: string[] = [];
  let routeAttempt = 0;
  let labelAttempt = 0;
  const labelSpacing = new Map<string, number>();
  // Compact top entry crosses only measured header whitespace; any route failure falls back to side entry.
  let compact = design;
  // Leaving compact mode restarts the side-entry ladder from scratch.
  const leaveCompact = () => {
    compact = false;
    labelAttempt = 0;
    labelSpacing.clear();
  };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await layout(diagram.nodes, diagram.edges, measured, design ? routeAttempt : attempt, design, labelSpacing, previous, horizontal, compact);
    headers = measureHeaders?.(diagram.nodes) ?? {};
    unresolved = design ? diagram.edges.filter(edge => !normalizeDiagonalBends(diagram.nodes, edge, headers)).map(edge => `orthogonal route: ${edge.id}`) : [];
    if (unresolved.length) {
      if (compact) leaveCompact();
      else routeAttempt += 1;
      continue;
    }
    const routeConflicts: string[] = [];
    if (design) {
      routeConflicts.push(...orderRoutePorts(diagram.nodes, diagram.edges, horizontal, headers), ...repairRouteObstacles(diagram.nodes, diagram.edges, headers));
      // Retry jog normalization after raw control collisions no longer block whole-route validation.
      for (const edge of diagram.edges) normalizeEndpointJogs(diagram.nodes, edge, horizontal, headers);
      routeConflicts.push(...repairRouteClearance(diagram.nodes, diagram.edges, headers));
    }
    if (design && !routeConflicts.length) preferStraightRoutes(diagram.nodes, diagram.edges, horizontal, headers);
    const failedLabels: DiagramEdge[] = [];
    unresolved = [...routeConflicts, ...placeLabels(diagram.nodes, diagram.edges, failedLabels, headers)];
    // One label-only retry stays compact; anything else falls back to side entry.
    if (compact && (routeConflicts.length || (failedLabels.length && labelAttempt))) {
      leaveCompact();
      continue;
    }
    if (routeConflicts.length) routeAttempt += 1;
    // Label-only retries widen their tracks and ports, not every card gap and container border.
    for (const edge of design ? failedLabels : []) {
      const parents = (id: string): string[] => {
        const parent = diagram.nodes.find(node => node.id === id)?.parentId;
        return parent ? [parent, ...parents(parent)] : ['root'];
      };
      const container = parents(edge.source).find(id => parents(edge.target).includes(id))!;
      // Parallel labels need both half-widths, not just clearance from a bare route.
      const parallel = diagram.edges.filter(other => other !== edge && other.source === edge.source && other.target === edge.target);
      const width = edge.labelBox!.width + Math.max(0, ...parallel.map(other => other.labelBox?.width ?? 0));
      const room = Math.max(width, edge.labelBox!.height) / 2 + 8 + labelAttempt * 32;
      for (const id of [edge.source, edge.target, container]) {
        labelSpacing.set(id, Math.max(room, labelSpacing.get(id) ?? EDGE_SPACING));
      }
    }
    if (failedLabels.length) labelAttempt += 1;
    if (!unresolved.length) {
      for (const edge of diagram.edges) {
        const subtitleGaps = boundaryHeaders(diagram.nodes, edge, headers).flatMap(({ node, header }) =>
          header.subtitleLines.map(box => ({ ...box, x: box.x + node.x, y: box.y + node.y })));
        edge.path = edgePath(edge.points, crossings(edge, diagram.edges), edge.labelBox, subtitleGaps);
      }
      return diagram;
    }
  }
  throw new Error(`Cannot route relationships or place labels without overlap: ${unresolved.join('; ')}`);
}

async function layout(nodes: DiagramNode[], edges: DiagramEdge[], measured: MeasuredGeometry | undefined, attempt: number, design: boolean, labelSpacing: Map<string, number>, previous?: Diagram, horizontal = false, compact = false): Promise<void> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const previousById = new Map(previous?.nodes.map(node => [node.id, node]));
  const preserveOrder: Record<string, string> = previousById.size ? {
    'elk.layered.crossingMinimization.semiInteractive': 'true',
    'elk.layered.interactiveReferencePoint': 'TOP_LEFT',
  } : {};
  const portSpacing = (id: string) => Math.max(EDGE_SPACING + attempt * 32, labelSpacing.get(id) ?? 0);
  // Compact layouts tighten routing channels only; card ports keep their wide slots.
  const edgeSpacing = (id: string) => compact ? Math.max(COMPACT_EDGE_SPACING, labelSpacing.get(id) ?? 0) : portSpacing(id);
  const padding = compact ? 24 : 64 + attempt * 48;
  const nodeSpacing = String((compact ? 32 : 64) + attempt * 32);
  // Side ports reserve the measured header above both external and parent-to-child routes.
  const toElk = (node: DiagramNode): ElkNode => {
    const ports = design && node.kind !== 'group' ? (['source', 'target'] as const).flatMap(role => {
      // Keep boundary-crossing bends outside the ports used by local routes.
      const neighborParent = (edge: DiagramEdge) => byId.get(edge[role === 'source' ? 'target' : 'source'])?.parentId;
      const connected = edges.filter(edge => edge[role] === node.id).sort((a, b) => {
        const crossing = Number(neighborParent(a) !== node.parentId) - Number(neighborParent(b) !== node.parentId);
        return role === 'source' ? crossing : -crossing;
      });
      const span = horizontal ? node.height : node.width;
      const gap = connected.length > 1 ? Math.min(portSpacing(node.id), Math.max(0, span - 48) / (connected.length - 1)) : 0;
      const local = connected.filter(edge => neighborParent(edge) === node.parentId);
      const centered = connected.length === 2 && local.length === 1 ? connected.indexOf(local[0]) : undefined;
      return connected.map((edge, index) => {
        // A unique local continuation owns the center; boundary traffic keeps a separate corner-safe slot.
        const across = centered === undefined ? (span - gap * (connected.length - 1)) / 2 + index * gap
          : span / 2 + (index - centered) * Math.min(gap, Math.max(0, span / 2 - 24));
        return {
          id: `${edge.id}:${role}`,
          x: horizontal ? (role === 'source' ? node.width : 0) : across,
          y: horizontal ? across : (role === 'source' ? node.height : 0),
          layoutOptions: { 'elk.port.side': horizontal ? (role === 'source' ? 'EAST' : 'WEST') : (role === 'source' ? 'SOUTH' : 'NORTH') },
        };
      });
    }) : [];
    const result: ElkNode = node.kind === 'group'
      ? {
          id: node.id,
          width: node.width,
          layoutOptions: {
            ...preserveOrder,
            'elk.direction': horizontal ? 'DOWN' : 'RIGHT',
            // Side entry keeps boundary routes below the header; compact entry lets ELK use the top edge.
            ...(compact ? {} : {
              ...(design ? { 'elk.layered.nodePlacement.strategy': 'SIMPLE' } : {}),
              'elk.portConstraints': 'FIXED_SIDE',
              'elk.spacing.portsSurrounding': `[top=${(node.headerHeight ?? 120) + 32},left=0,bottom=32,right=0]`,
            }),
            'elk.padding': `[top=${(node.headerHeight ?? 120) + 32},left=${padding},bottom=${padding},right=${padding}]`,
            'elk.layered.spacing.nodeNodeBetweenLayers': String(24 + attempt * 32),
            'elk.layered.spacing.edgeNodeBetweenLayers': String(12 + attempt * 12),
            'elk.spacing.nodeNode': nodeSpacing,
            ...(design ? { 'elk.spacing.portPort': String(EDGE_SPACING) } : {}),
            'elk.spacing.edgeEdge': String(edgeSpacing(node.id)),
            'elk.layered.spacing.edgeEdgeBetweenLayers': String(edgeSpacing(node.id)),
          },
          ports: edges.flatMap(edge => [
            ...(edge.source === node.id ? [{ id: `${edge.id}:source`, layoutOptions: { 'elk.port.side': 'WEST' } }] : []),
            ...(edge.target === node.id ? [{ id: `${edge.id}:target`, layoutOptions: { 'elk.port.side': 'WEST' } }] : []),
          ]),
          children: nodes.filter(child => child.parentId === node.id).map(toElk),
        }
      : {
          id: node.id, width: node.width, height: node.height,
          ...(design ? {
            layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
            ports,
          } : {}),
        };
    const prior = previousById.get(node.id);
    if (prior) {
      const parent = prior.parentId ? previousById.get(prior.parentId) : undefined;
      const x = prior.x - (parent?.x ?? 0);
      const y = prior.y - (parent?.y ?? 0);
      Object.assign(result, { x, y, layoutOptions: { ...result.layoutOptions, 'elk.position': `(${x},${y})` } });
    }
    return result;
  };
  const elkEdges: ElkExtendedEdge[] = edges.map(edge => {
    const lines = wrapLabel(edge.label);
    const size = measured?.labels[edge.id] ?? { width: Math.max(0, ...lines.map(line => line.length)) * 6.6 + 44, height: lines.length * 16 + 16 };
    return { id: edge.id, sources: [design || byId.get(edge.source)?.kind === 'group' ? `${edge.id}:source` : edge.source], targets: [design || byId.get(edge.target)?.kind === 'group' ? `${edge.id}:target` : edge.target], labels: [{ text: edge.label, ...size }] };
  });
  const input: ElkNode = {
    id: 'root',
    layoutOptions: {
      ...preserveOrder,
      'elk.algorithm': 'layered',
      'elk.direction': design && !horizontal ? 'DOWN' : 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.edgeLabels.inline': 'true',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      ...(design ? { 'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED' } : {}),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(24 + attempt * 32),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(12 + attempt * 12),
      'elk.spacing.nodeNode': nodeSpacing,
      ...(design ? { 'elk.spacing.portPort': String(EDGE_SPACING) } : {}),
      'elk.spacing.edgeEdge': String(edgeSpacing('root')),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(edgeSpacing('root')),
      'elk.spacing.edgeLabel': '6',
    },
    children: nodes.filter(node => !node.parentId).map(toElk),
    edges: elkEdges,
  };
  const elk = new ELK.default();
  if (design) {
    // Solve node and port order together before reserving fixed, corner-safe slots.
    const relax = (node: ElkNode): ElkNode => ({
      ...node,
      ...(byId.get(node.id)?.kind !== 'group' && node.ports?.length ? {
        layoutOptions: { ...node.layoutOptions, 'elk.portConstraints': 'FIXED_SIDE' },
        ports: node.ports.map(port => ({ id: port.id, layoutOptions: port.layoutOptions })),
      } : {}),
      children: node.children?.map(relax),
    });
    const ordered = await elk.layout(relax(input));
    const assign = (node: ElkNode, target: ElkNode): void => {
      if (byId.get(node.id)?.kind !== 'group') for (const role of ['source', 'target'] as const) {
        const local = new Set(edges.filter(edge => edge[role] === node.id
          && byId.get(edge.source)?.parentId === byId.get(edge.target)?.parentId).map(edge => `${edge.id}:${role}`));
        const across = horizontal ? 'y' : 'x';
        const ports = target.ports?.filter(port => local.has(port.id)).sort((a, b) => a[across]! - b[across]!) ?? [];
        const order = node.ports?.filter(port => local.has(port.id)).sort((a, b) => a[across]! - b[across]!) ?? [];
        ports.forEach((port, index) => { port.id = order[index].id; });
      }
      node.children?.forEach(child => assign(child, target.children!.find(candidate => candidate.id === child.id)!));
    };
    assign(ordered, input);
  }
  const result = await elk.layout(input);

  // ELK reports positions relative to the parent and edge geometry relative to the edge's container.
  const origin = new Map<string, Point>([['root', { x: 0, y: 0 }]]);
  const walk = (elkNode: ElkNode, offset: Point): void => {
    for (const child of elkNode.children ?? []) {
      const abs = { x: offset.x + (child.x ?? 0), y: offset.y + (child.y ?? 0) };
      origin.set(child.id, abs);
      Object.assign(byId.get(child.id) as DiagramNode, abs, { width: child.width ?? CARD_WIDTH, height: child.height ?? 120 });
      walk(child, abs);
    }
  };
  walk(result, { x: 0, y: 0 });
  const laidOut = new Map((result.edges ?? []).map((edge: ElkExtendedEdge) => [edge.id, edge]));
  for (const edge of edges) {
    const out = laidOut.get(edge.id);
    if (!out?.sections?.length || !out.labels?.length) {
      throw new Error(`Cannot route relationship: ${byId.get(edge.source)?.label ?? edge.source} ${edge.label} ${byId.get(edge.target)?.label ?? edge.target}`);
    }
    const offset = origin.get(out.container ?? 'root') ?? { x: 0, y: 0 };
    // Rounding drops ELK's float noise, so straight runs compare as exactly horizontal or vertical.
    const shift = (point: Point): Point => ({ x: Math.round((point.x + offset.x) * 10) / 10, y: Math.round((point.y + offset.y) * 10) / 10 });
    const section = out.sections[0];
    edge.points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(shift);
    // Stop just short of the box so the arrow tip touches the border instead of piercing it.
    const [beforeEnd, last] = edge.points.slice(-2);
    if (last && beforeEnd) {
      if (last.x === beforeEnd.x) last.y -= Math.sign(last.y - beforeEnd.y) * ARROW_INSET;
      else last.x -= Math.sign(last.x - beforeEnd.x) * ARROW_INSET;
    }
    const label = out.labels?.[0];
    if (label) edge.labelBox = { x: 0, y: 0, width: label.width ?? 0, height: label.height ?? 0, lines: wrapLabel(edge.label) };
  }
}

// ELK can emit diagonal compound-edge bends; try both elbows without moving either port.
function normalizeDiagonalBends(nodes: DiagramNode[], edge: DiagramEdge, headers: Record<string, HeaderGeometry>): boolean {
  const original = edge.points;
  if (original.every((point, index) => !index || point.x === original[index - 1].x || point.y === original[index - 1].y)) return true;
  for (const verticalFirst of [true, false]) {
    const points: Point[] = [];
    const append = (point: Point) => {
      const last = points.at(-1);
      if (last?.x === point.x && last.y === point.y) return;
      while (points.length >= 2) {
        const [a, b] = points.slice(-2);
        if (!((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) break;
        points.pop();
      }
      points.push(point);
    };
    for (const point of original) {
      const before = points.at(-1);
      if (before && before.x !== point.x && before.y !== point.y) append(verticalFirst ? { x: before.x, y: point.y } : { x: point.x, y: before.y });
      append(point);
    }
    edge.points = points;
    if (routeIsSafe(nodes, edge, headers)) return true;
  }
  edge.points = original;
  return false;
}

// Safe endpoint jogs can hide the departure direction or crowd a horizontal label.
function normalizeEndpointJogs(nodes: DiagramNode[], edge: DiagramEdge, horizontal: boolean, headers: Record<string, HeaderGeometry>): void {
  const across = horizontal ? 'y' : 'x';
  const along = horizontal ? 'x' : 'y';
  const limit = horizontal ? Math.max(ROUTE_CLEARANCE, (edge.labelBox?.height ?? 0) / 2 + 8) : ROUTE_CLEARANCE;
  for (const reverse of horizontal ? [true, false] : [false, true]) {
    while (edge.points.length >= 5) {
      const original = edge.points;
      const points = reverse ? [...original].reverse() : original;
      const [start, first, second, third] = points;
      if (start[across] !== first[across] || first[along] !== second[along] || second[across] !== third[across]
        || Math.abs(first[across] - second[across]) >= limit) break;
      const simplified: Point[] = [];
      for (const point of [start, { ...start, [along]: third[along] }, ...points.slice(4)]) {
        const last = simplified.at(-1);
        if (last?.x === point.x && last.y === point.y) continue;
        while (simplified.length >= 2) {
          const [a, b] = simplified.slice(-2);
          if (!((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) break;
          simplified.pop();
        }
        simplified.push(point);
      }
      edge.points = reverse ? simplified.reverse() : simplified;
      if (!routeIsSafe(nodes, edge, headers)) { edge.points = original; break; }
    }
  }
}

// Uncross only the endpoint elbows, retaining every node, port slot, and interior route.
function orderRoutePorts(nodes: DiagramNode[], edges: DiagramEdge[], horizontal: boolean, headers: Record<string, HeaderGeometry>): string[] {
  const across = horizontal ? 'y' : 'x';
  const along = horizontal ? 'x' : 'y';
  for (const edge of edges) normalizeEndpointJogs(nodes, edge, horizontal, headers);
  const unresolved: string[] = [];
  for (const node of nodes.filter(node => node.kind !== 'group')) for (const role of ['source', 'target'] as const) {
    const connected = edges.filter(edge => edge[role] === node.id).map(edge => {
      const indices = role === 'source' ? [0, 1, 2] : [edge.points.length - 1, edge.points.length - 2, edge.points.length - 3];
      const neighbor = nodes.find(candidate => candidate.id === edge[role === 'source' ? 'target' : 'source'])!;
      return { edge, indices, neighborAcross: neighbor[across] + (horizontal ? neighbor.height : neighbor.width) / 2 };
    });
    // A straight route needs new bends to move its port; leave that entire port group alone.
    if (connected.length < 2 || connected.some(({ edge, indices: [a, b, c] }) => edge.points.length < 4
      || edge.points[a][across] !== edge.points[b][across] || edge.points[b][along] !== edge.points[c][along])) continue;
    const slots = connected.map(({ edge, indices }) => edge.points[indices[0]][across]).sort((a, b) => a - b);
    connected.sort((a, b) => a.edge.points[a.indices[2]][across] - b.edge.points[b.indices[2]][across]
      || a.neighborAcross - b.neighborAcross || a.edge.id.localeCompare(b.edge.id));
    if (connected.every(({ edge, indices }, index) => edge.points[indices[0]][across] === slots[index])) continue;
    const original = edges.map(edge => edge.points);
    connected.forEach(({ edge, indices }, index) => {
      edge.points = edge.points.map((point, i) => i === indices[0] || i === indices[1] ? { ...point, [across]: slots[index] } : point);
    });
    // An existing interior control collision can be repaired without undoing safe port ordering.
    if (connected.some(({ edge }) => !routeIsSafe(nodes, edge, headers))) repairRouteObstacles(nodes, edges, headers);
    if (connected.some(({ edge }) => !routeIsSafe(nodes, edge, headers))) {
      edges.forEach((edge, index) => { edge.points = original[index]; });
      unresolved.push(`port order: ${node.id} ${role}`);
    }
  }
  return unresolved;
}

// A header measured at another width is stale and must not unblock anything.
const freshHeader = (node: DiagramNode, headers: Record<string, HeaderGeometry>) => {
  const header = headers[node.id];
  return header && Math.abs(header.width - node.width) < 1e-6 ? header : undefined;
};

// Only a genuine ancestor boundary crossing can use measured header whitespace.
function boundaryHeaders(nodes: DiagramNode[], edge: DiagramEdge, headers: Record<string, HeaderGeometry>) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const inside = (id: string, ancestor: string): boolean => {
    for (let parent = byId.get(id)?.parentId; parent; parent = byId.get(parent)?.parentId) {
      if (parent === ancestor) return true;
    }
    return false;
  };
  return nodes.flatMap(node => {
    const header = freshHeader(node, headers);
    return node.kind === 'group' && edge.source !== node.id && edge.target !== node.id && header
      && inside(edge.source, node.id) !== inside(edge.target, node.id)
      ? [{ node, header }] : [];
  });
}

function routeObstacles(nodes: DiagramNode[], edge: DiagramEdge, headers: Record<string, HeaderGeometry>): (Box & { id?: string })[] {
  const boundaries = new Set(boundaryHeaders(nodes, edge, headers).map(value => value.node.id));
  return nodes.flatMap<Box & { id?: string }>(node => {
    const controls = freshHeader(node, headers)?.hardObstacles.map(box => ({ ...box, x: node.x + box.x, y: node.y + box.y })) ?? [];
    // Measured controls never inherit the endpoint exemption, even on their own container.
    return [...(boundaries.has(node.id) ? [] : [node.kind === 'group' ? { ...node, height: node.headerHeight ?? 120 } : node]), ...controls];
  });
}

function routeIsSafe(nodes: DiagramNode[], edge: DiagramEdge, headers: Record<string, HeaderGeometry>): boolean {
  const obstacles = routeObstacles(nodes, edge, headers);
  const runs = edge.points.slice(1).map((b, index) => ({ index, a: edge.points[index], b }));
  for (const { a, b, index } of runs) {
    if (a.x === b.x && a.y === b.y) return false;
    if (a.x !== b.x && a.y !== b.y) return false;
    for (const box of obstacles) {
      // Endpoint segments may touch their own card, but must still stay outside its interior.
      const endpoint = (box.id === edge.source && index === 0) || (box.id === edge.target && index === runs.length - 1);
      const pad = endpoint ? 0 : 8;
      if (Math.min(a.x, b.x) < box.x + box.width + pad && Math.max(a.x, b.x) > box.x - pad
        && Math.min(a.y, b.y) < box.y + box.height + pad && Math.max(a.y, b.y) > box.y - pad) return false;
    }
    const next = edge.points[index + 2];
    if (next && (b.x - a.x) * (next.x - b.x) + (b.y - a.y) * (next.y - b.y) < 0) return false;
    for (const other of runs.slice(index + 2)) {
      if (Math.max(Math.min(a.x, b.x), Math.min(other.a.x, other.b.x)) <= Math.min(Math.max(a.x, b.x), Math.max(other.a.x, other.b.x))
        && Math.max(Math.min(a.y, b.y), Math.min(other.a.y, other.b.y)) <= Math.min(Math.max(a.y, b.y), Math.max(other.a.y, other.b.y))) return false;
    }
  }
  return true;
}

function routeClearanceConflicts(edges: DiagramEdge[], only?: DiagramEdge) {
  const clearance = ROUTE_CLEARANCE;
  const segments = (edge: DiagramEdge) => edge.points.slice(1).map((b, index) => ({ edge, index, a: edge.points[index], b }));
  const hits: { first: ReturnType<typeof segments>[number]; second: ReturnType<typeof segments>[number] }[] = [];
  for (const [index, edge] of (only ? [only] : edges).entries()) for (const other of (only ? edges.filter(other => other !== edge) : edges.slice(index + 1))) {
    for (const first of segments(edge)) for (const second of segments(other)) {
      const vertical = first.a.x === first.b.x && second.a.x === second.b.x;
      const horizontal = first.a.y === first.b.y && second.a.y === second.b.y;
      if (!vertical && !horizontal) continue;
      const axis = vertical ? 'y' : 'x';
      const across = vertical ? 'x' : 'y';
      const overlap = Math.min(Math.max(first.a[axis], first.b[axis]), Math.max(second.a[axis], second.b[axis]))
        - Math.max(Math.min(first.a[axis], first.b[axis]), Math.min(second.a[axis], second.b[axis]));
      if (overlap > clearance && Math.abs(first.a[across] - second.a[across]) < clearance) hits.push({ first, second });
    }
  }
  return hits;
}

// Check raw ELK routes too; shift one interior track before asking ELK for a wider layout.
function repairRouteObstacles(nodes: DiagramNode[], edges: DiagramEdge[], headers: Record<string, HeaderGeometry>): string[] {
  const unresolved: string[] = [];
  for (const edge of edges) {
    if (routeIsSafe(nodes, edge, headers)) continue;
    const original = edge.points;
    let best: { points: Point[]; distance: number } | undefined;
    for (let index = 1; index < original.length - 2; index += 1) {
      const a = original[index];
      const b = original[index + 1];
      const axis = a.x === b.x ? 'x' : 'y';
      const span = axis === 'x' ? 'width' : 'height';
      for (let end = index + 1; end < original.length - 1; end += 2) {
        for (const box of routeObstacles(nodes, edge, headers)) for (const value of [box[axis] - 8, box[axis] + box[span] + 8]) {
          edge.points = [...original.slice(0, index), { ...a, [axis]: value }, { ...original[end], [axis]: value }, ...original.slice(end + 1)];
          const distance = Math.abs(value - a[axis]);
          if ((!best || distance < best.distance) && routeIsSafe(nodes, edge, headers) && !routeClearanceConflicts(edges, edge).length) best = { points: edge.points, distance };
        }
      }
    }
    edge.points = best?.points ?? original;
    if (!best) unresolved.push(`route obstacle: ${edge.id}`);
  }
  return unresolved;
}

// Compound-boundary edges can share interior tracks despite ELK's edge spacing.
// Move only interior bends; dedicated ports and arrow endpoints remain untouched.
function repairRouteClearance(nodes: DiagramNode[], edges: DiagramEdge[], headers: Record<string, HeaderGeometry>): string[] {
  const clearance = ROUTE_CLEARANCE;
  const conflicts = (only?: DiagramEdge) => routeClearanceConflicts(edges, only);
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const hits = conflicts();
    if (!hits.length) return [];
    const incidentCounts = new Map<DiagramEdge, number>();
    for (const { first, second } of hits) for (const edge of [first.edge, second.edge]) {
      incidentCounts.set(edge, (incidentCounts.get(edge) ?? 0) + 1);
    }
    let best: { edge: DiagramEdge; points: Point[]; count: number; distance: number } | undefined;
    for (const { first, second } of hits) for (const [run, reference] of [[first, second], [second, first]]) {
      const { edge, index, a, b } = run;
      if (index === 0 || index === edge.points.length - 2) continue;
      const axis = a.x === b.x ? 'x' : 'y';
      for (const spacing of [clearance, EDGE_SPACING]) for (const sign of [-1, 1]) {
        const value = reference.a[axis] + sign * spacing;
        const original = edge.points;
        edge.points = original.map((point, i) => i === index || i === index + 1 ? { ...point, [axis]: value } : point);
        const count = routeIsSafe(nodes, edge, headers) ? hits.length - (incidentCounts.get(edge) ?? 0) + conflicts(edge).length : hits.length;
        const distance = Math.abs(value - a[axis]);
        if (count < hits.length && (!best || count < best.count || (count === best.count && distance < best.distance))) {
          best = { edge, points: edge.points, count, distance };
        }
        edge.points = original;
      }
    }
    if (!best) break;
    best.edge.points = best.points;
  }
  return conflicts().map(({ first, second }) => `route clearance: ${first.edge.id} / ${second.edge.id}`);
}

// ELK's inline labels can leave doglegs after their positions are discarded.
function preferStraightRoutes(nodes: DiagramNode[], edges: DiagramEdge[], horizontal: boolean, headers: Record<string, HeaderGeometry>): void {
  const across = horizontal ? 'y' : 'x';
  const along = horizontal ? 'x' : 'y';
  const span = horizontal ? 'height' : 'width';
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const edge of edges) {
    if (edge.points.length <= 2) continue;
    const source = byId.get(edge.source)!;
    const target = byId.get(edge.target)!;
    // Container ports belong to ELK's boundary routing, not ordinary card sides.
    if (source.kind === 'group' || target.kind === 'group') continue;
    const start = { ...edge.points[0] };
    const end = { ...edge.points.at(-1)! };
    const sourcePorts = edges.filter(other => other.source === source.id).length;
    const targetPorts = edges.filter(other => other.target === target.id).length;
    if (start[across] !== end[across]) {
      if (targetPorts === 1) end[across] = start[across];
      else if (sourcePorts === 1) start[across] = end[across];
      else continue;
    }
    const onSide = (point: Point, node: DiagramNode, role: 'source' | 'target') => {
      const normal = node[along] + (role === 'source' ? node[horizontal ? 'width' : 'height'] : -ARROW_INSET);
      return point[along] === Math.round(normal * 10) / 10
        && point[across] >= node[across] + 24 && point[across] <= node[across] + node[span] - 24;
    };
    if (!onSide(start, source, 'source') || !onSide(end, target, 'target') || end[along] <= start[along]) continue;
    const trial = edges.map(other => ({ ...other, points: other === edge ? [start, end] : other.points,
      labelBox: other.labelBox ? { ...other.labelBox } : undefined }));
    const candidate = trial[edges.indexOf(edge)];
    if (!routeIsSafe(nodes, candidate, headers) || routeClearanceConflicts(trial, candidate).length || placeLabels(nodes, trial, [], headers).length) continue;
    edge.points = candidate.points;
    edges.forEach((other, index) => { other.labelBox = trial[index].labelBox; });
  }
}

// ELK misplaces labels on edges that cross group borders, so each label tries spots along its own straight runs,
// longest first, and takes the first that clears every box, group header, and earlier label.
export function placeLabels(nodes: DiagramNode[], edges: DiagramEdge[], failedLabels: DiagramEdge[] = [], headers: Record<string, HeaderGeometry> = {}): string[] {
  const pad = 8;
  const unresolved: string[] = [];
  const taken: Box[] = nodes.map(node => (node.kind === 'group' ? { ...node, height: node.headerHeight ?? 120 } : node));
  for (const node of nodes) {
    const header = freshHeader(node, headers);
    if (header) taken.push(...header.hardObstacles.map(box => ({ ...box, x: node.x + box.x, y: node.y + box.y })));
  }
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
    const intersects = (box: Box, a: Point, b: Point) =>
      Math.min(a.x, b.x) < box.x + box.width + pad && Math.max(a.x, b.x) > box.x - pad
      && Math.min(a.y, b.y) < box.y + box.height + pad && Math.max(a.y, b.y) > box.y - pad;
    const crossesOtherRoute = (box: Box) => edges.some(other => {
      const hits = other.points.slice(1).filter((b, index) => intersects(box, other.points[index], b)).length;
      return hits > (other === edge ? 1 : 0);
    });
    const spot = spots.find(box => clear(box) && !crossesOtherRoute(box));
    if (!spot) { failedLabels.push(edge); unresolved.push(`${nodes.find(node => node.id === edge.source)?.label ?? edge.source} ${edge.label} ${nodes.find(node => node.id === edge.target)?.label ?? edge.target}`); continue; }
    Object.assign(label, spot);
    taken.push(label);
  }
  return unresolved;
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
