import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { AlignmentGraph, AlignmentPack } from '../lib/alignment-packs.js';

export const CARD_WIDTH = 300;
export const LABEL_WIDTH = 196;
export type Size = { width: number; height: number };
export type MeasuredGeometry = { nodes: Record<string, Size>; labels: Record<string, Size> };
const HOP_RADIUS = 5;
const CORNER_RADIUS = 6;
const ARROW_INSET = 2;
const LABEL_CHARS = 24;
const EDGE_SPACING = 80;
const ROUTE_CLEARANCE = 12;

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

export async function buildDiagram(graph: AlignmentGraph, expandedGroups: string[], measured?: MeasuredGeometry, anchor?: Pick<DiagramNode, 'id' | 'x' | 'y'>): Promise<Diagram> {
  const diagram = projectDiagram(graph, expandedGroups);
  for (const node of diagram.nodes) {
    const size = measured?.nodes[node.id];
    if (size) Object.assign(node, size);
    node.headerHeight = node.height;
  }
  const design = graph.groups.some(group => group.id === 'design:root');
  let unresolved: string[] = [];
  let routeAttempt = 0;
  let labelAttempt = 0;
  const labelSpacing = new Map<string, number>();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await layout(diagram.nodes, diagram.edges, measured, design ? routeAttempt : attempt, design, labelSpacing);
    const routeConflicts = design
      ? [...orderRoutePorts(diagram.nodes, diagram.edges), ...repairRouteClearance(diagram.nodes, diagram.edges)] : [];
    const failedLabels: DiagramEdge[] = [];
    unresolved = [...routeConflicts, ...placeLabels(diagram.nodes, diagram.edges, failedLabels)];
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
      const anchored = anchor && diagram.nodes.find(node => node.id === anchor.id);
      if (anchored && anchor) {
        const dx = anchor.x - anchored.x;
        const dy = anchor.y - anchored.y;
        for (const point of [...diagram.nodes, ...diagram.edges.flatMap(edge => [...edge.points, ...(edge.labelBox ? [edge.labelBox] : [])])]) {
          point.x += dx;
          point.y += dy;
        }
        anchored.x = anchor.x;
        anchored.y = anchor.y;
      }
      for (const edge of diagram.edges) edge.path = edgePath(edge.points, crossings(edge, diagram.edges), edge.labelBox);
      return diagram;
    }
  }
  throw new Error(`Cannot route relationships or place labels without overlap: ${unresolved.join('; ')}`);
}

async function layout(nodes: DiagramNode[], edges: DiagramEdge[], measured: MeasuredGeometry | undefined, attempt: number, design: boolean, labelSpacing: Map<string, number>): Promise<void> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edgeSpacing = (id: string) => Math.max(EDGE_SPACING + attempt * 32, labelSpacing.get(id) ?? 0);
  // Side ports reserve the measured header above both external and parent-to-child routes.
  const toElk = (node: DiagramNode): ElkNode => {
    const ports = design && node.kind !== 'group' ? (['source', 'target'] as const).flatMap(role => {
      // Keep boundary-crossing bends outside the ports used by local routes.
      const neighborParent = (edge: DiagramEdge) => byId.get(edge[role === 'source' ? 'target' : 'source'])?.parentId;
      const connected = edges.filter(edge => edge[role] === node.id).sort((a, b) => {
        const crossing = Number(neighborParent(a) !== node.parentId) - Number(neighborParent(b) !== node.parentId);
        return role === 'source' ? crossing : -crossing;
      });
      const gap = connected.length > 1 ? Math.min(edgeSpacing(node.id), Math.max(0, node.width - 48) / (connected.length - 1)) : 0;
      return connected.map((edge, index) => ({
        id: `${edge.id}:${role}`,
        x: (node.width - gap * (connected.length - 1)) / 2 + index * gap,
        y: role === 'source' ? node.height : 0,
        layoutOptions: { 'elk.port.side': role === 'source' ? 'SOUTH' : 'NORTH' },
      }));
    }) : [];
    return node.kind === 'group'
      ? {
          id: node.id,
          width: node.width,
          layoutOptions: {
            'elk.direction': 'RIGHT',
            'elk.portConstraints': 'FIXED_SIDE',
            'elk.spacing.portsSurrounding': `[top=${(node.headerHeight ?? 120) + 32},left=0,bottom=32,right=0]`,
            'elk.padding': `[top=${(node.headerHeight ?? 120) + 32},left=${64 + attempt * 48},bottom=${64 + attempt * 48},right=${64 + attempt * 48}]`,
            'elk.layered.spacing.nodeNodeBetweenLayers': String(24 + attempt * 32),
            'elk.layered.spacing.edgeNodeBetweenLayers': String(12 + attempt * 12),
            'elk.spacing.nodeNode': String(64 + attempt * 32),
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
  };
  const elkEdges: ElkExtendedEdge[] = edges.map(edge => {
    const lines = wrapLabel(edge.label);
    const size = measured?.labels[edge.id] ?? { width: Math.max(0, ...lines.map(line => line.length)) * 6.6 + 44, height: lines.length * 16 + 16 };
    return { id: edge.id, sources: [design || byId.get(edge.source)?.kind === 'group' ? `${edge.id}:source` : edge.source], targets: [design || byId.get(edge.target)?.kind === 'group' ? `${edge.id}:target` : edge.target], labels: [{ text: edge.label, ...size }] };
  });
  const result = await new ELK.default().layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': design ? 'DOWN' : 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.edgeLabels.inline': 'true',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      ...(design ? { 'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED' } : {}),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(24 + attempt * 32),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(12 + attempt * 12),
      'elk.spacing.nodeNode': String(64 + attempt * 32),
      ...(design ? { 'elk.spacing.portPort': String(EDGE_SPACING) } : {}),
      'elk.spacing.edgeEdge': String(edgeSpacing('root')),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(edgeSpacing('root')),
      'elk.spacing.edgeLabel': '6',
    },
    children: nodes.filter(node => !node.parentId).map(toElk),
    edges: elkEdges,
  });

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

// ELK can insert sub-clearance endpoint jogs that hide the actual departure or approach direction.
function normalizeEndpointJogs(nodes: DiagramNode[], edge: DiagramEdge): void {
  for (const reverse of [false, true]) {
    while (edge.points.length >= 5) {
      const original = edge.points;
      const points = reverse ? [...original].reverse() : original;
      const [start, first, second, third] = points;
      if (start.x !== first.x || first.y !== second.y || second.x !== third.x
        || Math.abs(first.x - second.x) >= ROUTE_CLEARANCE) break;
      const simplified: Point[] = [];
      for (const point of [start, { x: start.x, y: third.y }, ...points.slice(4)]) {
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
      if (!routeIsSafe(nodes, edge)) { edge.points = original; break; }
    }
  }
}

// Uncross only the endpoint elbows, retaining every node, port slot, and interior route.
function orderRoutePorts(nodes: DiagramNode[], edges: DiagramEdge[]): string[] {
  for (const edge of edges) normalizeEndpointJogs(nodes, edge);
  const unresolved: string[] = [];
  for (const node of nodes.filter(node => node.kind !== 'group')) for (const role of ['source', 'target'] as const) {
    const connected = edges.filter(edge => edge[role] === node.id).map(edge => {
      const indices = role === 'source' ? [0, 1, 2] : [edge.points.length - 1, edge.points.length - 2, edge.points.length - 3];
      const neighbor = nodes.find(candidate => candidate.id === edge[role === 'source' ? 'target' : 'source'])!;
      return { edge, indices, neighborX: neighbor.x + neighbor.width / 2 };
    });
    // A straight route needs new bends to move its port; leave that entire port group alone.
    if (connected.length < 2 || connected.some(({ edge, indices: [a, b, c] }) => edge.points.length < 4
      || edge.points[a].x !== edge.points[b].x || edge.points[b].y !== edge.points[c].y)) continue;
    const slots = connected.map(({ edge, indices }) => edge.points[indices[0]].x).sort((a, b) => a - b);
    connected.sort((a, b) => a.edge.points[a.indices[2]].x - b.edge.points[b.indices[2]].x
      || a.neighborX - b.neighborX || a.edge.id.localeCompare(b.edge.id));
    if (connected.every(({ edge, indices }, index) => edge.points[indices[0]].x === slots[index])) continue;
    const original = connected.map(({ edge }) => edge.points);
    connected.forEach(({ edge, indices }, index) => {
      edge.points = edge.points.map((point, i) => i === indices[0] || i === indices[1] ? { ...point, x: slots[index] } : point);
    });
    if (connected.some(({ edge }) => !routeIsSafe(nodes, edge))) {
      connected.forEach(({ edge }, index) => { edge.points = original[index]; });
      unresolved.push(`port order: ${node.id} ${role}`);
    }
  }
  return unresolved;
}

function routeIsSafe(nodes: DiagramNode[], edge: DiagramEdge): boolean {
  const obstacles = nodes.map(node => node.kind === 'group' ? { ...node, height: node.headerHeight ?? 120 } : node);
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

// Compound-boundary edges can share interior tracks despite ELK's edge spacing.
// Move only interior bends; dedicated ports and arrow endpoints remain untouched.
function repairRouteClearance(nodes: DiagramNode[], edges: DiagramEdge[]): string[] {
  const clearance = ROUTE_CLEARANCE;
  const segments = (edge: DiagramEdge) => edge.points.slice(1).map((b, index) => ({ edge, index, a: edge.points[index], b }));
  const conflicts = (only?: DiagramEdge) => {
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
  };
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
      for (const sign of [-1, 1]) {
        const value = reference.a[axis] + sign * EDGE_SPACING;
        const original = edge.points;
        edge.points = original.map((point, i) => i === index || i === index + 1 ? { ...point, [axis]: value } : point);
        const count = routeIsSafe(nodes, edge) ? hits.length - (incidentCounts.get(edge) ?? 0) + conflicts(edge).length : hits.length;
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

// ELK misplaces labels on edges that cross group borders, so each label tries spots along its own straight runs,
// longest first, and takes the first that clears every box, group header, and earlier label.
export function placeLabels(nodes: DiagramNode[], edges: DiagramEdge[], failedLabels: DiagramEdge[] = []): string[] {
  const pad = 8;
  const unresolved: string[] = [];
  const taken: Box[] = nodes.map(node => (node.kind === 'group' ? { ...node, height: node.headerHeight ?? 120 } : node));
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
        if (gap && hop.x + HOP_RADIUS >= gap.x && hop.x - HOP_RADIUS <= gap.x + gap.width && hop.y + HOP_RADIUS >= gap.y && hop.y - HOP_RADIUS <= gap.y + gap.height) continue;
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
