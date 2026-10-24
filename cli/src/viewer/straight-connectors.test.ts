import { describe, expect, it } from 'vitest';
import type { AlignmentGraph, DiagramOrientation } from '../lib/alignment-packs.js';
import { designDocToPack, loadDesignDoc } from '../lib/design-doc.js';
import { buildDiagram, projectDiagram, type Box, type Diagram, type DiagramEdge, type MeasuredGeometry, type Point, type DiagramNode, type HeaderGeometry, type HeaderMeasurer } from './alignment-graph.js';

const orientations: DiagramOrientation[] = ['top-to-bottom', 'left-to-right'];
const epsilon = 1e-6;

// Invented content measurements, not saved positions or ELK output.
function fixture(nested = true): AlignmentGraph {
  return {
    groups: [
      { id: 'design:root', label: 'Root', summary: 'Root', sourceRefs: [] },
      ...(nested ? [{ id: 'frame', parentGroupId: 'design:root', label: 'Frame', summary: 'Frame', sourceRefs: [] }] : []),
    ],
    nodes: ['sender', 'worker', 'receiver'].map(id => ({ id, groupId: nested ? 'frame' : 'design:root', label: id, summary: id, sourceRefs: [] })),
    edges: [
      { id: 'send', fromNodeId: 'sender', toNodeId: 'worker', label: 'Sends', summary: 'Sends', relationship: 'design', sourceRefs: [] },
      { id: 'review', fromNodeId: 'worker', toNodeId: 'receiver', label: 'Reviews', summary: 'Reviews', relationship: 'design', direction: 'bidirectional', sourceRefs: [] },
    ],
    aggregateEdges: [],
  };
}
function measured(graph: AlignmentGraph, expanded: string[]): MeasuredGeometry {
  const projection = projectDiagram(graph, expanded);
  return {
    nodes: Object.fromEntries(projection.nodes.map(node => [node.id, { width: 300, height: node.kind === 'group' ? 106 : 136 }])),
    labels: Object.fromEntries(projection.edges.map(edge => [edge.id, { width: 196, height: 28 }])),
  };
}
const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
const overlaps = (a: Box, b: Box) => overlap(a.x, a.x + a.width, b.x, b.x + b.width) > epsilon
  && overlap(a.y, a.y + a.height, b.y, b.y + b.height) > epsilon;
const segments = (edge: DiagramEdge) => edge.points.slice(1).map((end, i) => ({ start: edge.points[i], end }));
const crosses = (start: Point, end: Point, box: Box) => Math.abs(start.x - end.x) < epsilon
  ? start.x > box.x + epsilon && start.x < box.x + box.width - epsilon && overlap(start.y, end.y, box.y, box.y + box.height) > epsilon
  : start.y > box.y + epsilon && start.y < box.y + box.height - epsilon && overlap(start.x, end.x, box.x, box.x + box.width) > epsilon;
// A group's top header includes its title and controls; its open body is not an obstacle.
const obstacles = (diagram: Diagram): Box[] => diagram.nodes.map(node => node.kind === 'group' ? { ...node, height: node.headerHeight! } : node);

function routeObstacles(diagram: Diagram, edge: DiagramEdge, headers: Record<string, HeaderGeometry>): Box[] {
  const inside = (id: string, ancestor: string): boolean => {
    for (let node = diagram.nodes.find(candidate => candidate.id === id); node; node = diagram.nodes.find(candidate => candidate.id === node.parentId)) {
      if (node.id === ancestor) return true;
    }
    return false;
  };
  return diagram.nodes.flatMap(node => {
    const header = headers[node.id];
    const boundary = inside(edge.source, node.id) !== inside(edge.target, node.id);
    if (node.kind === 'group' && boundary && header && Math.abs(header.width - node.width) < epsilon) {
      return header.hardObstacles.map(box => ({ ...box, x: box.x + node.x, y: box.y + node.y }));
    }
    return [node.kind === 'group' ? { ...node, height: node.headerHeight! } : node];
  });
}

function expectSafe(diagram: Diagram, graph: AlignmentGraph, sizes: MeasuredGeometry, orientation: DiagramOrientation, headers: Record<string, HeaderGeometry> = {}) {
  const horizontal = orientation === 'left-to-right';
  expect(diagram.edges.flatMap(edge => edge.childEdgeIds).sort()).toEqual(graph.edges.map(edge => edge.id).sort());
  for (const edge of diagram.edges) {
    const relationship = graph.edges.find(candidate => edge.childEdgeIds.includes(candidate.id))!;
    expect(edge.source).toBe(diagram.nodeToVisible[relationship.fromNodeId]);
    expect(edge.target).toBe(diagram.nodeToVisible[relationship.toNodeId]);
    expect(edge.bidirectional).toBe(relationship.direction === 'bidirectional');
    for (const role of ['source', 'target'] as const) {
      const node = diagram.nodes.find(candidate => candidate.id === edge[role])!;
      const point = role === 'source' ? edge.points[0] : edge.points.at(-1)!;
      const inset = role === 'target' ? -2 : 0;
      expect(horizontal ? point.x : point.y).toBeCloseTo(horizontal ? node.x + (role === 'source' ? node.width : inset) : node.y + (role === 'source' ? node.height : inset), 5);
      expect(horizontal ? point.y : point.x).toBeGreaterThan(horizontal ? node.y : node.x);
      expect(horizontal ? point.y : point.x).toBeLessThan(horizontal ? node.y + node.height : node.x + node.width);
    }
    const label = edge.labelBox!;
    expect(label.lines.join(' ')).toBe(edge.label);
    expect({ width: label.width, height: label.height }).toEqual(sizes.labels[edge.id]);
    const otherLabels = diagram.edges.filter(other => other !== edge).map(other => other.labelBox!);
    for (const box of [...obstacles(diagram), ...otherLabels]) expect(overlaps(label, box), `${edge.label} label overlaps an obstacle`).toBe(false);
    for (const { start, end } of segments(edge)) {
      expect(start.x === end.x || start.y === end.y, `${edge.label} is orthogonal`).toBe(true);
      for (const box of [...routeObstacles(diagram, edge, headers), ...otherLabels]) expect(crosses(start, end, box), `${edge.label} crosses a card, header, or unrelated label`).toBe(false);
    }
  }
  for (const edge of diagram.edges) {
    const runs = segments(edge);
    for (const [i, a] of runs.entries()) for (const b of runs.slice(i + 2)) {
      const verticalA = a.start.x === a.end.x;
      const verticalB = b.start.x === b.end.x;
      if (verticalA === verticalB) {
        const along = verticalA ? 'y' : 'x';
        const across = verticalA ? 'x' : 'y';
        expect(a.start[across] === b.start[across] && overlap(a.start[along], a.end[along], b.start[along], b.end[along]) > epsilon, 'route cannot retrace itself').toBe(false);
      } else {
        const [v, h] = verticalA ? [a, b] : [b, a];
        const intersects = v.start.x >= Math.min(h.start.x, h.end.x) - epsilon && v.start.x <= Math.max(h.start.x, h.end.x) + epsilon
          && h.start.y >= Math.min(v.start.y, v.end.y) - epsilon && h.start.y <= Math.max(v.start.y, v.end.y) + epsilon;
        expect(intersects, 'continuous route cannot intersect itself').toBe(false);
      }
    }
  }
  for (const [i, first] of diagram.edges.entries()) for (const second of diagram.edges.slice(i + 1)) {
    for (const a of segments(first)) for (const b of segments(second)) {
      const vertical = a.start.x === a.end.x && b.start.x === b.end.x;
      const horizontalRun = a.start.y === a.end.y && b.start.y === b.end.y;
      if (!vertical && !horizontalRun) continue;
      const axis = vertical ? 'y' : 'x';
      const across = vertical ? 'x' : 'y';
      if (overlap(a.start[axis], a.end[axis], b.start[axis], b.end[axis]) > 12 + epsilon) {
        expect(Math.abs(a.start[across] - b.start[across]), 'parallel routes retain clearance').toBeGreaterThanOrEqual(12 - epsilon);
      }
    }
  }
}

describe('straight connectors with measured content and real ELK', () => {
  it.each(orientations.flatMap(orientation => ['send', 'review'].map(id => ({ orientation, id }))))(
    'keeps $id axis-straight inside an expanded frame in $orientation when aligned ports have a clear corridor',
    async ({ orientation, id }) => {
      const graph = fixture();
      const sizes = measured(graph, ['frame']);
      const diagram = await buildDiagram(graph, ['frame'], sizes, undefined, orientation);
      expectSafe(diagram, graph, sizes, orientation);
      const edge = diagram.edges.find(candidate => candidate.childEdgeIds.includes(id))!;
      const start = edge.points[0];
      const end = edge.points.at(-1)!;
      const across = orientation === 'left-to-right' ? 'y' : 'x';
      const along = across === 'x' ? 'y' : 'x';
      // Preconditions are assertions, never skips: this fixture must exercise the promised clear corridor.
      expect(end[across], 'ports align').toBeCloseTo(start[across], 5);
      expect(end[along]).toBeGreaterThan(start[along]);
      for (const box of [...obstacles(diagram), ...diagram.edges.filter(other => other !== edge).map(other => other.labelBox!)]) {
        expect(crosses(start, end, box), 'direct corridor is clear').toBe(false);
      }
      for (const point of edge.points) {
        expect.soft(point[across], `${id}: unnecessary deviation from the aligned port axis`).toBeCloseTo(start[across], 5);
        expect(point[along]).toBeGreaterThanOrEqual(start[along]);
        expect(point[along]).toBeLessThanOrEqual(end[along]);
      }
    },
  );

  it.each(orientations)('retains a safe bend in %s when a third card blocks aligned endpoints', async orientation => {
    const graph = fixture(false);
    graph.edges.push({ id: 'bypass', fromNodeId: 'sender', toNodeId: 'receiver', label: 'Bypass', summary: 'Bypass', relationship: 'design', sourceRefs: [] });
    const sizes = measured(graph, []);
    if (orientation === 'left-to-right') sizes.nodes['item:worker'].height = 400;
    const diagram = await buildDiagram(graph, [], sizes, undefined, orientation);
    expectSafe(diagram, graph, sizes, orientation);
    const edge = diagram.edges.find(candidate => candidate.childEdgeIds.includes('bypass'))!;
    const worker = diagram.nodes.find(node => node.refId === 'worker')!;
    const start = edge.points[0];
    const end = edge.points.at(-1)!;
    const across = orientation === 'left-to-right' ? 'y' : 'x';
    expect(end[across], 'blocked ports still align').toBeCloseTo(start[across], 5);
    expect(crosses(start, end, worker), 'straightening would cut through the third card').toBe(true);
    expect(edge.points.some(point => Math.abs(point[across] - start[across]) > epsilon), 'obstruction requires an off-axis detour').toBe(true);
  });
});

function boundaryFixture() {
  const graph = fixture();
  graph.groups.push({ id: 'outer', parentGroupId: 'design:root', label: 'Workspace', summary: 'Workspace', sourceRefs: [] });
  graph.groups[1].parentGroupId = 'outer';
  graph.nodes[0].groupId = 'outer';
  return graph;
}

// Header input uses local content rectangles, never route points or saved node positions.
function headerContent(nodes: readonly DiagramNode[], shortOnly = false, hardBlock = false): Record<string, HeaderGeometry> {
  return Object.fromEntries(nodes.filter(node => node.kind === 'group').map(node => [node.id, {
    width: node.width,
    hardObstacles: [
      { x: 24, y: 12, width: 72, height: 20 }, // title
      { x: 108, y: 12, width: 48, height: 20 }, // pill
      { x: node.width - 44, y: 12, width: 24, height: 24 }, // toggle
      { x: 24, y: 40, width: hardBlock ? node.width - 80 : 100, height: 12 }, // technical text
    ],
    subtitleLines: [
      ...(!shortOnly ? [{ x: 24, y: 70, width: node.width - 84, height: 12 }] : []),
      { x: 24, y: 92, width: 72, height: 10 }, // short wrapped line leaves whitespace beside it
    ],
  }]));
}

// Flatten the viewer's SVG M/L/Q paths for visible-ink assertions, independently of route points.
function drawnSegments(path: string): { start: Point; end: Point }[] {
  const tokens = path.match(/[MLQmlq]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? [];
  const result: { start: Point; end: Point }[] = [];
  let point: Point = { x: 0, y: 0 };
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++];
    const next = (): Point => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) });
    if (command === 'M') point = next();
    else if (command === 'L') {
      const end = next();
      result.push({ start: point, end });
      point = end;
    } else if (command === 'Q') {
      const control = next();
      const end = next();
      const start = point;
      for (let step = 1; step <= 32; step++) {
        const t = step / 32;
        const sample = {
          x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
          y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
        };
        result.push({ start: point, end: sample });
        point = sample;
      }
    } else throw new Error(`Unsupported SVG command in visible-ink test: ${command}`);
  }
  return result;
}
function drawsAt(edge: DiagramEdge, point: Point): boolean {
  return drawnSegments(edge.path).some(({ start, end }) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(start.x + t * dx - point.x, start.y + t * dy - point.y) < epsilon;
  });
}

const expandedBoundary = ['outer', 'frame'];

describe('measured ancestor header whitespace and subtitle ink', () => {
  it.each([
    { shortOnly: false, widthNoise: false },
    { shortOnly: false, widthNoise: true },
    { shortOnly: true, widthNoise: false },
  ])('straightens a boundary route with local subtitle gaps, shortOnly=$shortOnly widthNoise=$widthNoise', async ({ shortOnly, widthNoise }) => {
    const graph = boundaryFixture();
    const sizes = measured(graph, expandedBoundary);
    const calls: Record<string, HeaderGeometry>[] = [];
    const measureHeaders: HeaderMeasurer = nodes => {
      const headers = headerContent(nodes, shortOnly);
      if (widthNoise) for (const header of Object.values(headers)) header.width += 1e-8;
      calls.push(headers);
      return headers;
    };
    const diagram = await buildDiagram(graph, expandedBoundary, sizes, undefined, 'top-to-bottom', measureHeaders);
    const headers = headerContent(diagram.nodes, shortOnly);
    const edge = diagram.edges.find(candidate => candidate.childEdgeIds.includes('send'))!;
    const start = edge.points[0];
    const end = edge.points.at(-1)!;
    const frame = diagram.nodes.find(node => node.id === 'group:frame')!;
    const worker = diagram.nodes.find(node => node.refId === 'worker')!;
    // No position is prescribed: the source's vertical ray must land on the target's flat top border.
    expect(start.x).toBeGreaterThan(worker.x + 24);
    expect(start.x).toBeLessThan(worker.x + worker.width - 24);
    expect(start.y).toBeLessThan(frame.y);
    expect(end.y).toBeGreaterThan(frame.y + frame.headerHeight!);
    for (const box of routeObstacles(diagram, edge, headers)) expect(crosses(start, { x: start.x, y: end.y }, box), 'candidate corridor has no hard obstacle').toBe(false);
    expectSafe(diagram, graph, sizes, 'top-to-bottom', headers);
    expect.soft(end.x, 'unique target attachment may shift along its flat border to meet the source axis').toBeCloseTo(start.x, 5);
    for (const point of edge.points) expect.soft(point.x, 'boundary route stays vertical through ancestor whitespace').toBeCloseTo(start.x, 5);
    const inkAt = (localY: number) => drawsAt(edge, { x: start.x, y: frame.y + localY });
    expect.soft(inkAt(60), 'draw the whitespace above the subtitle').toBe(true);
    expect.soft(inkAt(94), 'short wrapped line beside the route must not erase nearby whitespace').toBe(true);
    if (!shortOnly) {
      const subtitle = headers[frame.id].subtitleLines[0];
      expect(start.x).toBeGreaterThan(frame.x + subtitle.x);
      expect(start.x).toBeLessThan(frame.x + subtitle.x + subtitle.width);
      expect.soft(inkAt(76), 'crossed subtitle glyph fragment must interrupt SVG ink, not continuous route geometry').toBe(false);
      const glyphs = { ...subtitle, x: frame.x + subtitle.x, y: frame.y + subtitle.y };
      for (const run of drawnSegments(edge.path)) expect(crosses(run.start, run.end, glyphs), 'SVG ink excludes the entire intersected glyph fragment').toBe(false);
      expect(edge.points.some(point => point.y <= frame.y + 70)).toBe(true);
      expect(edge.points.some(point => point.y >= frame.y + 82)).toBe(true);
    } else expect.soft(inkAt(76), 'no gap where the subtitle has no glyphs').toBe(true);
    for (const node of diagram.nodes.filter(node => node.kind === 'group')) expect(node.headerHeight, 'header dimensions stay conservative').toBe(sizes.nodes[node.id].height);
    expect.soft(calls.some(call => Object.entries(headers).every(([id, header]) => Math.abs((call[id]?.width ?? NaN) - header.width) < epsilon)), 'measurements use final frame widths').toBe(true);
  });

  it('keeps hard header content blocked even when subtitle gaps are allowed', async () => {
    const graph = boundaryFixture();
    const sizes = measured(graph, expandedBoundary);
    const measureHeaders: HeaderMeasurer = nodes => headerContent(nodes, false, true);
    const diagram = await buildDiagram(graph, expandedBoundary, sizes, undefined, 'top-to-bottom', measureHeaders);
    const headers = headerContent(diagram.nodes, false, true);
    expectSafe(diagram, graph, sizes, 'top-to-bottom', headers);
    const edge = diagram.edges.find(candidate => candidate.childEdgeIds.includes('send'))!;
    const start = edge.points[0];
    const end = edge.points.at(-1)!;
    const frame = diagram.nodes.find(node => node.id === 'group:frame')!;
    const technical = headers[frame.id].hardObstacles[3];
    expect(crosses(start, { x: start.x, y: end.y }, { ...technical, x: frame.x + technical.x, y: frame.y + technical.y }), 'straight candidate hits technical text').toBe(true);
    expect(edge.points.some(point => Math.abs(point.x - start.x) > epsilon), 'hard content requires a detour').toBe(true);
  });

  it.each(['size-only', 'missing', 'stale-width'] as const)('retains whole-header blocking for %s measurements', async mode => {
    const graph = boundaryFixture();
    const sizes = measured(graph, expandedBoundary);
    const measureHeaders: HeaderMeasurer | undefined = mode === 'size-only' ? undefined : nodes => {
      const headers = headerContent(nodes);
      if (mode === 'missing') delete headers['group:frame'];
      else headers['group:frame'].width -= 1;
      return headers;
    };
    const diagram = await buildDiagram(graph, expandedBoundary, sizes, undefined, 'top-to-bottom', measureHeaders);
    // No valid authorization is supplied to the safety oracle either.
    expectSafe(diagram, graph, sizes, 'top-to-bottom');
    const edge = diagram.edges.find(candidate => candidate.childEdgeIds.includes('send'))!;
    const frame = diagram.nodes.find(node => node.id === 'group:frame')!;
    const start = edge.points[0];
    const end = edge.points.at(-1)!;
    expect(crosses(start, { x: start.x, y: end.y }, { ...frame, height: frame.headerHeight! }), 'direct candidate crosses the unmeasured header').toBe(true);
    expect(edge.points.some(point => Math.abs(point.x - start.x) > epsilon)).toBe(true);
    expect(frame.headerHeight).toBe(sizes.nodes[frame.id].height);
  });
});

it('keeps an unrelated header fully blocked despite valid measurements of whitespace in its direct corridor', async () => {
  const graph = boundaryFixture();
  graph.groups.push({ id: 'unrelated', parentGroupId: 'outer', label: 'Other subsystem', summary: 'Other', sourceRefs: [] });
  graph.nodes.push({ id: 'sentinel', groupId: 'unrelated', label: 'Sentinel', summary: 'Sentinel', sourceRefs: [] });
  graph.edges.push(
    { ...graph.edges[0], id: 'first-hop', toNodeId: 'sentinel' },
    { ...graph.edges[0], id: 'last-hop', fromNodeId: 'sentinel' },
  );
  const expanded = [...expandedBoundary, 'unrelated'];
  const sizes = measured(graph, expanded);
  const measureHeaders: HeaderMeasurer = nodes => {
    const headers = headerContent(nodes);
    const unrelated = headers['group:unrelated'];
    unrelated.hardObstacles[0].x = 100;
    unrelated.hardObstacles[3].x = 100;
    unrelated.subtitleLines = [{ x: 100, y: 70, width: 100, height: 12 }];
    return headers;
  };
  const diagram = await buildDiagram(graph, expanded, sizes, undefined, 'top-to-bottom', measureHeaders);
  const headers = measureHeaders(diagram.nodes);
  expectSafe(diagram, graph, sizes, 'top-to-bottom', headers);
  const unrelated = diagram.nodes.find(node => node.id === 'group:unrelated')!;
  const headerBox = { ...unrelated, height: unrelated.headerHeight! };
  // Compact layouts may route around the container entirely; whatever the route, the header stays opaque to it.
  const edge = diagram.edges.find(candidate => candidate.childEdgeIds.includes('send'))!;
  for (const { start: a, end: b } of segments(edge)) expect(crosses(a, b, headerBox), 'unrelated header remains opaque to routing').toBe(false);
});

// Clip a line against the rectangle interior, including the diagonal samples of SVG curves.
function segmentIntersectsBox(start: Point, end: Point, box: Box): boolean {
  let entry = 0;
  let exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const low = box[axis] + epsilon;
    const high = box[axis] + (axis === 'x' ? box.width : box.height) - epsilon;
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < epsilon) {
      if (start[axis] <= low || start[axis] >= high) return false;
    } else {
      const a = (low - start[axis]) / delta;
      const b = (high - start[axis]) / delta;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
  }
  return entry < exit;
}

it.each(orientations)('avoids measured hover controls outside an unrelated expanded group in %s', async orientation => {
  const graph = boundaryFixture();
  graph.groups.push({ id: 'unrelated', parentGroupId: 'outer', label: 'Other subsystem', summary: 'Other', sourceRefs: [] });
  graph.nodes.push({ id: 'sentinel', groupId: 'unrelated', label: 'Sentinel', summary: 'Sentinel', sourceRefs: [] });
  graph.edges.push(
    { ...graph.edges[0], id: 'first-hop', toNodeId: 'sentinel' },
    { ...graph.edges[0], id: 'last-hop', fromNodeId: 'sentinel' },
  );
  const expanded = [...expandedBoundary, 'unrelated'];
  const sizes = measured(graph, expanded);
  const measureHeaders: HeaderMeasurer = nodes => {
    const headers = headerContent(nodes);
    const group = nodes.find(node => node.id === 'group:unrelated')!;
    // Invented hover action strip protruding beyond the group's top border.
    headers[group.id].hardObstacles.push(orientation === 'top-to-bottom'
      ? { x: -120, y: -32, width: 160, height: 24 }
      : { x: 0, y: -80, width: 160, height: 32 });
    return headers;
  };
  const diagram = await buildDiagram(graph, expanded, sizes, undefined, orientation, measureHeaders);
  const headers = measureHeaders(diagram.nodes);
  const group = diagram.nodes.find(node => node.id === 'group:unrelated')!;
  const local = headers[group.id].hardObstacles.at(-1)!;
  const control = { ...local, x: group.x + local.x, y: group.y + local.y };
  const unrelatedRoute = diagram.edges.find(edge => edge.childEdgeIds.includes('send'))!;
  expect(unrelatedRoute).toMatchObject({ source: 'item:sender', target: 'item:worker' });
  expect(diagram.nodes.find(node => node.id === unrelatedRoute.source)!.parentId).not.toBe(group.id);
  expect(diagram.nodes.find(node => node.id === unrelatedRoute.target)!.parentId).not.toBe(group.id);
  expect(control.y + control.height).toBeLessThan(group.y);
  for (const edge of diagram.edges) {
    expect.soft(segments(edge).some(({ start, end }) => crosses(start, end, control)), `${edge.id} route geometry must avoid the external hover control`).toBe(false);
    expect.soft(drawnSegments(edge.path).some(({ start, end }) => segmentIntersectsBox(start, end, control)), `${edge.id} visible ink must avoid the external hover control`).toBe(false);
    expect.soft(overlaps(edge.labelBox!, control), `${edge.id} label must avoid the external hover control`).toBe(false);
    expect(drawsAt(edge, edge.points[0]), 'safe alternative still draws at its source').toBe(true);
    expect(drawsAt(edge, edge.points.at(-1)!), 'safe alternative still draws at its target').toBe(true);
  }
  expectSafe(diagram, graph, sizes, orientation, headers);
});

it('avoids measured comment actions above an unrelated leaf without opening its body', async () => {
  const graph = fixture(false);
  graph.edges.push({ ...graph.edges[0], id: 'bypass', toNodeId: 'receiver', label: 'Bypass' });
  graph.edges.reverse();
  const sizes = measured(graph, []);
  sizes.nodes['item:worker'] = { width: 200, height: 136 };
  const measureHeaders: HeaderMeasurer = nodes => Object.fromEntries(nodes.filter(node => node.kind === 'item').map(node => [node.id, {
    width: node.width,
    // viewer.css: right: 0; bottom: 100%; padding-bottom: 8px; 32px button.
    hardObstacles: [{ x: node.width - 32, y: -40, width: 32, height: 32 }],
    subtitleLines: [{ x: 24, y: 70, width: 72, height: 12 }],
  }]));
  const diagram = await buildDiagram(graph, [], sizes, undefined, 'left-to-right', measureHeaders);
  const headers = measureHeaders(diagram.nodes);
  const worker = diagram.nodes.find(node => node.id === 'item:worker')!;
  const local = headers[worker.id].hardObstacles[0];
  const control = { ...local, x: worker.x + local.x, y: worker.y + local.y };
  const bypass = diagram.edges.find(edge => edge.childEdgeIds.includes('bypass'))!;
  expect(worker.kind).toBe('item');
  expect(bypass).toMatchObject({ source: 'item:sender', target: 'item:receiver' });
  expect(control.y + control.height).toBeLessThan(worker.y);
  for (const edge of diagram.edges) {
    for (const node of diagram.nodes) {
      const button = headers[node.id].hardObstacles[0];
      const bounds = { ...button, x: node.x + button.x, y: node.y + button.y };
      expect.soft(segments(edge).some(({ start, end }) => crosses(start, end, bounds)), `${edge.id} route geometry must avoid ${node.id} comment action`).toBe(false);
      expect.soft(drawnSegments(edge.path).some(({ start, end }) => segmentIntersectsBox(start, end, bounds)), `${edge.id} visible ink must avoid ${node.id} comment action`).toBe(false);
      expect.soft(overlaps(edge.labelBox!, bounds), `${edge.id} label must avoid ${node.id} comment action`).toBe(false);
    }
    expect(drawsAt(edge, edge.points[0]), 'safe alternative still draws at its source').toBe(true);
    expect(drawsAt(edge, edge.points.at(-1)!), 'safe alternative still draws at its target').toBe(true);
  }
  expectSafe(diagram, graph, sizes, 'left-to-right', headers);
});

const publicExample = () => designDocToPack(loadDesignDoc(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url).pathname)).graph;
const extent = (diagram: Diagram) => {
  const corners = diagram.nodes.flatMap(node => [{ x: node.x, y: node.y }, { x: node.x + node.width, y: node.y + node.height }]);
  return (Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x)))
    * (Math.max(...corners.map(point => point.y)) - Math.min(...corners.map(point => point.y)));
};
const bends = (diagram: Diagram) => diagram.edges.reduce((sum, edge) => sum + edge.points.length - 2, 0);

it.each(orientations)('uses measured header whitespace to shrink the expanded public example in %s', async orientation => {
  const graph = publicExample();
  const expanded = graph.groups.map(group => group.id);
  const sizes = measured(graph, expanded);
  const measureHeaders: HeaderMeasurer = nodes => headerContent(nodes);
  // Without header measurements every boundary route enters from the side, as before compact top entry.
  const sideEntry = await buildDiagram(graph, expanded, sizes, undefined, orientation);
  const diagram = await buildDiagram(graph, expanded, sizes, undefined, orientation, measureHeaders);
  expectSafe(diagram, graph, sizes, orientation, measureHeaders(diagram.nodes));
  // Left-to-right routes reach containers from the side anyway, so only top-to-bottom changes. Measured: 1963520 px2 and 20 bends become 1392384 and 4.
  if (orientation === 'top-to-bottom') {
    expect(extent(diagram)).toBeLessThanOrEqual(extent(sideEntry) * 0.8);
    expect(bends(diagram)).toBeLessThanOrEqual(bends(sideEntry) / 2);
  }
});
