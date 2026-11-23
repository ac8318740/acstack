import type { DiagramOrientation } from '../lib/alignment-packs.js';
import { CARD_WIDTH, edgePath, wrapLabel, type Box, type DiagramEdge, type DiagramNode, type Point, type Size } from './alignment-graph.js';
import { routeSegments as segs, searchOrthogonalRoute, simplifyRoute } from './orthogonal-route.js';

// One arrow router for placed cards: cheap shapes first (straight, one bend, two bends), a lane search
// for the rest, one rip-up pass for arrows that cross, and an arrow that still fails is drawn anyway and
// flagged. Labels go last and never move another arrow.

export type RoutedEdge = DiagramEdge & { unrouted?: boolean; labelUnplaced?: boolean };

type Side = 'top' | 'bottom' | 'left' | 'right';
type Axis = 'x' | 'y';
type Seg = { a: Point; b: Point };
type End = { node: DiagramNode; side: Side; lo: number; hi: number; c: number };
type Obstacle = Box & { id: string };
type Via = 'shape' | 'lanes' | 'search' | 'forced';
type Route = { points: Point[]; via: Via };
// Work the slow searches may still do in one view: lane-search states expanded, grid-search budget, and whether the
// view is past its routing budget (see ROUTE_MS), after which every phase stops improving and finishes with what it has.
type Budget = { lanes: number; search: number; late: () => boolean };

const SIDES: Side[] = ['top', 'bottom', 'left', 'right'];
const PAD = 8;          // card and header clearance
const CLEAR = 12;       // parallel arrows keep this apart
const STUB = 16;        // shortest run leaving or entering a card before a bend
const MARGIN = 24;      // ports keep away from card corners
const MAX_GAP = 60;     // widest spacing between ports on one side
const ARROW_INSET = 2;
const CORNER = 6;
const BEND = 100, CROSS = 150, LENGTH = 0.1, TOUCH = 1_000;
const SEARCH_BUDGET = 3_000, VIEW_SEARCH_BUDGET = 12_000, ROUNDS = 4;
const LANE_WINDOW = 600;      // the lane search tries this far around the ports before the whole diagram
// Lane-search states one search may expand (successful searches rarely need 8000) and all searches in a view
// may expand; together they hold the slowest view under 300 ms.
const LANE_SEARCH_STATES = 8_000, VIEW_LANE_BUDGET = 100_000;
// Routes, then labels, stop improving once a view has spent both this time and this work (segment and box tests).
// The time keeps a view with placement under 300 ms on graphs far denser than a map; the work, just above the
// heaviest fixture view's, keeps the fixture views independent of machine speed. There is no hard time cut: cutting
// mid-route leaves overlaps, and the work budget already bounds the time. A machine 2x slower takes about 2x as long.
// A relayout that also tries a fresh placement (see buildDiagram) routes twice, so it can take up to about twice as long.
const ROUTE_MS = 140, ROUTE_WORK = 1_350_000, LABEL_MS = 40, LABEL_WORK = 1_000_000;
const PENALTY: Record<Via, number> = { shape: 0, lanes: 200, search: 1e3, forced: 1e6 };

const normal = (side: Side): { axis: Axis; sign: number } => ({ axis: side === 'top' || side === 'bottom' ? 'y' : 'x', sign: side === 'bottom' || side === 'right' ? 1 : -1 });
const across = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
const span = (axis: Axis) => (axis === 'x' ? 'width' : 'height');
const length = (points: Point[]) => segs(points).reduce((sum, { a, b }) => sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 0);
const bends = (points: Point[]) => Math.max(0, points.length - 2);
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const centre = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

function labelSize(edge: DiagramEdge, labelSizes: Record<string, Size>): Size {
  return labelSizes[edge.id] ?? {
    width: Math.max(...wrapLabel(edge.label).map(line => line.length)) * 6.6 + 16, height: wrapLabel(edge.label).length * 16 + 12,
  };
}

function sideRange(node: Box, side: Side): [number, number] {
  const axis = across(normal(side).axis);
  const margin = Math.min(MARGIN, node[span(axis)] / 2);
  return [node[axis] + margin, node[axis] + node[span(axis)] - margin];
}

function middleEnd(node: DiagramNode, side: Side): End {
  const [lo, hi] = sideRange(node, side);
  return { node, side, lo, hi, c: Math.round((lo + hi) / 2) };
}

function port(node: Box, side: Side, t: number): Point {
  if (side === 'top') return { x: t, y: node.y };
  if (side === 'bottom') return { x: t, y: node.y + node.height };
  if (side === 'left') return { x: node.x, y: t };
  return { x: node.x + node.width, y: t };
}

// Up to `count` positions between from and to, middle first, then alternating outwards in steps.
function samples(from: number, to: number, step = CLEAR, count = 24): number[] {
  const lo = Math.min(from, to), hi = Math.max(from, to), mid = Math.round((lo + hi) / 2);
  // A bad measurement (NaN or infinite) must not loop forever.
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const values = [mid];
  for (let k = 1; values.length < count; k++) {
    const down = mid - k * step, up = mid + k * step;
    if (down < lo && up > hi) break;
    if (down >= lo) values.push(down);
    if (up <= hi) values.push(up);
  }
  return values;
}

/** Every straight, one-bend (L), and two-bend (Z or U) route between two card sides that keeps STUB off each card. */
function shapes(S: End, T: End): Point[][] {
  const nS = normal(S.side), nT = normal(T.side);
  const ps = (t: number) => port(S.node, S.side, t), pt = (t: number) => port(T.node, T.side, t);
  const opts = (end: End) => [...new Set([end.c, end.lo, end.hi, Math.round((end.c + end.lo) / 2), Math.round((end.c + end.hi) / 2)])];
  const out: Point[][] = [];
  if (nS.axis === nT.axis) {
    const ax = nS.axis;
    const sv = ps(S.c)[ax], tv = pt(T.c)[ax];
    if (nS.sign === -nT.sign) {
      if ((tv - sv) * nS.sign < 2 * STUB) return out;
      const lo = Math.max(S.lo, T.lo), hi = Math.min(S.hi, T.hi);
      if (lo <= hi) {
        for (const t of new Set([clamp(Math.round((S.c + T.c) / 2), lo, hi), clamp(S.c, lo, hi), clamp(T.c, lo, hi), lo, hi])) out.push([ps(t), pt(t)]);
      }
      // The middle run sits mid-way or, for long gaps, in one of the first lanes beside either card.
      const near = sv + nS.sign * STUB, far = tv - nS.sign * STUB;
      const ms = [...samples(near, far), ...[0, 1, 2, 3].flatMap(k => [near + nS.sign * k * CLEAR, far - nS.sign * k * CLEAR])];
      if (S.c !== T.c) for (const m of new Set(ms)) {
        out.push([ps(S.c), { ...ps(S.c), [ax]: m }, { ...pt(T.c), [ax]: m }, pt(T.c)]);
      }
    } else {
      const far = nS.sign > 0 ? Math.max(sv, tv) : Math.min(sv, tv);
      for (let k = 0; k < 6; k++) {
        const m = far + nS.sign * (STUB + 8 + k * CLEAR);
        out.push([ps(S.c), { ...ps(S.c), [ax]: m }, { ...pt(T.c), [ax]: m }, pt(T.c)]);
      }
    }
  } else {
    for (const t of opts(S)) for (const u of opts(T)) {
      const from = ps(t), to = pt(u);
      const corner = { ...from, [nS.axis]: u };
      if ((u - from[nS.axis]) * nS.sign >= STUB && (t - to[nT.axis]) * nT.sign >= STUB) out.push([from, corner, to]);
    }
  }
  return out;
}

// Segment and box tests run so far, the deterministic measure of routing work (see ROUTE_WORK).
let work = 0;

function hitsBox(a: Point, b: Point, box: Box, pad: number): boolean {
  work++;
  return Math.min(a.x, b.x) < box.x + box.width + pad && Math.max(a.x, b.x) > box.x - pad
    && Math.min(a.y, b.y) < box.y + box.height + pad && Math.max(a.y, b.y) > box.y - pad;
}

// Obstacle hits, except an arrow's first run may leave its own source and its last run enter its own target.
function blocked(points: Point[], obstacles: Obstacle[], edge: DiagramEdge): number {
  const runs = segs(points);
  let hits = 0;
  runs.forEach(({ a, b }, index) => {
    for (const box of obstacles) {
      if ((box.id === edge.source && index === 0) || (box.id === edge.target && index === runs.length - 1)) continue;
      if (hitsBox(a, b, box, PAD)) hits++;
    }
  });
  return hits;
}

// Two arrow segments ignore each other, cross cleanly at a right angle, or conflict
// (run alongside closer than CLEAR, or touch at a bend or end, which reads as a merge).
function relation(p: Seg, q: Seg): 'none' | 'cross' | 'conflict' {
  work++;
  const pv = p.a.x === p.b.x, qv = q.a.x === q.b.x;
  if (pv === qv) {
    const ax: Axis = pv ? 'y' : 'x', ac = across(ax);
    if (Math.abs(p.a[ac] - q.a[ac]) >= CLEAR) return 'none';
    const overlap = Math.min(Math.max(p.a[ax], p.b[ax]), Math.max(q.a[ax], q.b[ax])) - Math.max(Math.min(p.a[ax], p.b[ax]), Math.min(q.a[ax], q.b[ax]));
    return overlap > -4 ? 'conflict' : 'none';
  }
  const [h, v] = pv ? [q, p] : [p, q];
  const x1 = Math.min(h.a.x, h.b.x), x2 = Math.max(h.a.x, h.b.x), y1 = Math.min(v.a.y, v.b.y), y2 = Math.max(v.a.y, v.b.y);
  const vx = v.a.x, hy = h.a.y, tol = 4;
  if (vx < x1 - tol || vx > x2 + tol || hy < y1 - tol || hy > y2 + tol) return 'none';
  return vx > x1 + tol && vx < x2 - tol && hy > y1 + tol && hy < y2 - tol ? 'cross' : 'conflict';
}

function against(points: Point[], others: Seg[]): { crossings: number; conflicts: number } {
  let crossings = 0, conflicts = 0;
  for (const p of segs(points)) for (const q of others) {
    const kind = relation(p, q);
    if (kind === 'cross') crossings++;
    else if (kind === 'conflict') conflicts++;
  }
  return { crossings, conflicts };
}

// Bends, crossings, and length; undefined when the route conflicts with another arrow.
function cost(points: Point[], others: Seg[]): number | undefined {
  const { crossings, conflicts } = against(points, others);
  return conflicts ? undefined : bends(points) * BEND + crossings * CROSS + length(points) * LENGTH;
}

// The whole view: bends, length, and the fallback penalty per arrow, plus every crossing once.
function totalCost(routes: Map<string, Route>): number {
  const list = [...routes.values()];
  return list.reduce((sum, { points, via }, index) => sum + bends(points) * BEND + length(points) * LENGTH + PENALTY[via]
    + list.slice(index + 1).reduce((crossings, other) => crossings + against(points, segs(other.points)).crossings * CROSS, 0), 0);
}

/**
 * Routes every edge between placed nodes (absolute coordinates) and places its label. Never throws:
 * an edge no route clears is drawn anyway with `unrouted`, and a label with no clear spot gets `labelUnplaced`.
 * Edges with a missing endpoint come back with no points and `unrouted`.
 */
export function routeDiagram(nodes: DiagramNode[], edges: DiagramEdge[], labelSizes: Record<string, Size>, orientation: DiagramOrientation): RoutedEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ancestors = (id: string) => {
    const ids = new Set<string>();
    for (let at = byId.get(id)?.parentId; at && !ids.has(at); at = byId.get(at)?.parentId) ids.add(at);
    return ids;
  };
  const groups = nodes.filter(node => node.kind === 'group');
  const cards = nodes.filter(node => node.kind !== 'group');
  // A group's header content is a CARD_WIDTH column at its top-left; arrows may cross the band beside it.
  const headers: Obstacle[] = groups.map(group => ({ id: group.id, x: group.x, y: group.y, width: Math.min(group.width, CARD_WIDTH), height: group.headerHeight ?? 120 }));
  const main: Axis = orientation === 'left-to-right' ? 'x' : 'y';
  // Lanes may run up to 200 px outside the placed nodes.
  const bounds = { x: Math.min(...nodes.map(n => n.x)) - 200, y: Math.min(...nodes.map(n => n.y)) - 200, width: 0, height: 0 };
  bounds.width = Math.max(...nodes.map(n => n.x + n.width)) + 200 - bounds.x;
  bounds.height = Math.max(...nodes.map(n => n.y + n.height)) + 200 - bounds.y;
  const routable = edges.filter(edge => byId.has(edge.source) && byId.has(edge.target));
  const deadline = performance.now() + ROUTE_MS;
  const started = work;
  const late = () => (work - started > ROUTE_WORK && performance.now() > deadline);
  const budget: Budget = { lanes: VIEW_LANE_BUDGET, search: VIEW_SEARCH_BUDGET, late };


  // Cards, group headers, and the frames of groups that contain neither end.
  const obstacleCache = new Map<string, Obstacle[]>();
  const obstaclesFor = (edge: DiagramEdge, frames = true): Obstacle[] => {
    const key = `${edge.id}|${frames}`;
    const cached = obstacleCache.get(key);
    if (cached) return cached;
    const related = new Set([...ancestors(edge.source), ...ancestors(edge.target), edge.source, edge.target]);
    const list: Obstacle[] = [
      ...cards,
      ...headers.filter(header => header.id !== edge.source && header.id !== edge.target),
      ...(frames ? groups.filter(group => !related.has(group.id)) : []),
    ];
    obstacleCache.set(key, list);
    return list;
  };

  // Side pairs with a clear shape, cheapest first, ignoring other arrows: fewest bends, then shortest, then the main
  // flow axis. An edge with none gets the pair facing along the longer axis between its cards.
  const sideOptions = (edge: DiagramEdge, banned: Set<string>): { cost: number; sides: [Side, Side] }[] => {
    const S = byId.get(edge.source)!, T = byId.get(edge.target)!;
    const options: { cost: number; sides: [Side, Side] }[] = [];
    for (const sS of SIDES) for (const sT of SIDES) {
      if (banned.has(`${sS}|${sT}`)) continue;
      let cheapest = Infinity;
      for (const points of shapes(middleEnd(S, sS), middleEnd(T, sT))) {
        if (blocked(points, obstaclesFor(edge), edge)) continue;
        const offAxis = Number(normal(sS).axis !== main) + Number(normal(sT).axis !== main);
        cheapest = Math.min(cheapest, bends(points) * BEND + length(points) * LENGTH + offAxis);
      }
      if (cheapest < Infinity) options.push({ cost: cheapest, sides: [sS, sT] });
    }
    if (options.length) return options.sort((a, b) => a.cost - b.cost);
    const d = { x: centre(T).x - centre(S).x, y: centre(T).y - centre(S).y };
    return [{ cost: 0, sides: Math.abs(d.x) > Math.abs(d.y) ? (d.x > 0 ? ['right', 'left'] : ['left', 'right']) : (d.y > 0 ? ['bottom', 'top'] : ['top', 'bottom']) }];
  };

  // Each edge takes its cheapest side pair, but a card side holds only the arrow ends that fit along it (see need):
  // while one is over, the edge on it whose next pair with room costs least extra moves there (the shorter edge on a tie).
  const chooseSides = (banned: Map<string, Set<string>>): Map<string, [Side, Side]> => {
    const options = new Map(routable.map(edge => [edge.id, sideOptions(edge, banned.get(edge.id) ?? new Set())]));
    const pick = new Map(routable.map(edge => [edge.id, 0]));
    const load = new Map<string, number>(), count = new Map<string, number>(), room = new Map<string, number>();
    const key = (edge: DiagramEdge, role: number, side: Side) => `${role ? edge.target : edge.source}\u0000${side}`;
    const roomAt = (edge: DiagramEdge, role: number, side: Side) => {
      const at = key(edge, role, side);
      if (!room.has(at)) {
        const [lo, hi] = sideRange(byId.get(role ? edge.target : edge.source)!, side);
        room.set(at, hi - lo + CLEAR);
      }
      return room.get(at)!;
    };
    const free = (edge: DiagramEdge, role: number, side: Side) => roomAt(edge, role, side) - (load.get(key(edge, role, side)) ?? 0);
    const crowded = (edge: DiagramEdge, role: number, side: Side) => (count.get(key(edge, role, side)) ?? 0) * CLEAR > roomAt(edge, role, side);
    // Room an arrow end takes along a side: CLEAR, or for a labelled arrow about a third of its label's depth across
    // the arrow plus padding, so labels on a bundle leaving the side can stagger clear of each other (tuned on the fixtures).
    const need = (edge: DiagramEdge, side: Side) => !edge.label ? CLEAR
      : Math.max(CLEAR, labelSize(edge, labelSizes)[normal(side).axis === 'y' ? 'width' : 'height'] * 0.3 + PAD + 2);
    const add = (edge: DiagramEdge, sides: [Side, Side], by: number) => sides.forEach((side, role) => {
      load.set(key(edge, role, side), (load.get(key(edge, role, side)) ?? 0) + by * need(edge, side));
      count.set(key(edge, role, side), (count.get(key(edge, role, side)) ?? 0) + by);
    });
    for (const edge of routable) add(edge, options.get(edge.id)![0].sides, 1);
    for (;;) {
      let move: { edge: DiagramEdge; to: number; extra: number; cost: number } | undefined;
      for (const edge of routable) {
        const list = options.get(edge.id)!, at = list[pick.get(edge.id)!];
        const over = at.sides.map((side, role) => free(edge, role, side) < 0);
        if (!over.some(Boolean)) continue;
        // Ports closer than CLEAR force a move to any side with room for one more port; room for labels only moves
        // an arrow to a side with room for its label too.
        const forced = at.sides.some((side, role) => crowded(edge, role, side));
        const fits = (side: Side, role: number) => forced
          ? ((count.get(key(edge, role, side)) ?? 0) + 1) * CLEAR <= roomAt(edge, role, side)
          : free(edge, role, side) >= need(edge, side);
        const to = list.findIndex((option, index) => index > pick.get(edge.id)!
          && option.sides.some((side, role) => over[role] && side !== at.sides[role])
          && option.sides.every((side, role) => side === at.sides[role] || fits(side, role)));
        const extra = to < 0 ? Infinity : list[to].cost - at.cost;
        if (to >= 0 && (!move || extra < move.extra || (extra === move.extra && at.cost < move.cost))) move = { edge, to, extra, cost: at.cost };
      }
      if (!move) break;
      const list = options.get(move.edge.id)!;
      add(move.edge, list[pick.get(move.edge.id)!].sides, -1);
      add(move.edge, list[move.to].sides, 1);
      pick.set(move.edge.id, move.to);
    }
    return new Map(routable.map(edge => [edge.id, options.get(edge.id)![pick.get(edge.id)!].sides]));
  };

  // Ports spread evenly round the side's middle, ordered by the angle to the far card so neighbouring arrows do not cross.
  const assignPorts = (sides: Map<string, [Side, Side]>) => {
    const ends = new Map<string, { node: DiagramNode; side: Side; list: { edge: DiagramEdge; role: 0 | 1; key: number }[] }>();
    for (const edge of routable) {
      const pair = sides.get(edge.id)!;
      for (const role of [0, 1] as const) {
        const node = byId.get(role ? edge.target : edge.source)!, far = byId.get(role ? edge.source : edge.target)!;
        const side = pair[role], n = normal(side), mid = port(node, side, centre(node)[across(n.axis)]);
        const v = { x: centre(far).x - mid.x, y: centre(far).y - mid.y };
        const key = Math.atan2(v[across(n.axis)], v[n.axis] * n.sign);
        const id = `${node.id}|${side}`;
        const entry = ends.get(id) ?? { node, side, list: [] };
        entry.list.push({ edge, role, key });
        ends.set(id, entry);
      }
    }
    const result = new Map<string, [End, End]>();
    for (const { node, side, list } of ends.values()) {
      list.sort((a, b) => a.key - b.key || a.edge.id.localeCompare(b.edge.id));
      const [lo, hi] = sideRange(node, side);
      // Wider apart, room permitting, when a label must fit between its arrow and the next.
      const depth = normal(side).axis === 'y' ? 'width' : 'height';
      const room = Math.max(MAX_GAP, ...list.filter(({ edge }) => edge.label).map(({ edge }) => labelSize(edge, labelSizes)[depth] / 2 + PAD + 2));
      const gap = list.length > 1 ? Math.min(room, (hi - lo) / (list.length - 1)) : 0;
      const first = (lo + hi) / 2 - (gap * (list.length - 1)) / 2;
      list.forEach(({ edge, role }, index) => {
        const c = Math.round(first + index * gap);
        const end: End = { node, side, c, lo: index ? Math.ceil(c - gap / 2 + CLEAR / 2) : lo, hi: index < list.length - 1 ? Math.floor(c + gap / 2 - CLEAR / 2) : hi };
        const pair = result.get(edge.id) ?? [end, end];
        pair[role] = end;
        result.set(edge.id, pair);
      });
    }
    return result;
  };

  // Lane search near the ports, then over the whole diagram, with and without unrelated frames as obstacles.
  const lanes = (edge: DiagramEdge, [S, T]: [End, End], others: Seg[]): Point[] | undefined => {
    const a = port(S.node, S.side, S.c), b = port(T.node, T.side, T.c);
    const x = Math.max(bounds.x, Math.min(a.x, b.x) - LANE_WINDOW), y = Math.max(bounds.y, Math.min(a.y, b.y) - LANE_WINDOW);
    const near = { x, y, width: Math.min(bounds.x + bounds.width, Math.max(a.x, b.x) + LANE_WINDOW) - x, height: Math.min(bounds.y + bounds.height, Math.max(a.y, b.y) + LANE_WINDOW) - y };
    const areas = near.width === bounds.width && near.height === bounds.height ? [bounds] : [near, bounds];
    // Without unrelated frames only when the edge has any.
    const sets = obstaclesFor(edge, true).length === obstaclesFor(edge, false).length ? [true] : [true, false];
    for (const frames of sets) {
      const obstacles = obstaclesFor(edge, frames);
      for (const area of areas) {
        const found = laneSearch(S, T, obstacles, others, area, budget);
        if (found && !blocked(found, obstacles, edge) && cost(found, others) !== undefined) return found;
      }
    }
    return undefined;
  };

  const search = (edge: DiagramEdge, [S, T]: [End, End], routes: Point[][], others: Seg[]): Point[] | undefined => {
    const start = port(S.node, S.side, S.c), end = port(T.node, T.side, T.c);
    const nS = normal(S.side), nT = normal(T.side);
    const from = { ...start, [nS.axis]: start[nS.axis] + nS.sign * 10 }, to = { ...end, [nT.axis]: end[nT.axis] + nT.sign * 10 };
    for (const frames of [true, false]) {
      if (budget.search <= 0 || late()) return undefined;
      const obstacles = obstaclesFor(edge, frames);
      const middle = searchOrthogonalRoute(from, to, obstacles, routes, [start, end], { remaining: Math.min(SEARCH_BUDGET, budget.search) });
      budget.search -= SEARCH_BUDGET;
      const found = middle && simplifyRoute([start, ...middle, end]);
      if (found && !blocked(found, obstacles, edge) && cost(found, others) !== undefined) return found;
    }
    return undefined;
  };

  // One arrow against the routed ones and the reserved port stubs: the cheapest clear shape, else the lane search,
  // else the bounded grid search, else the least bad shape drawn anyway as forced.
  const routeOne = (edge: DiagramEdge, pair: [End, End], routed: Point[][], reserved: Seg[]): Route => {
    const others = [...routed.flatMap(segs), ...reserved];
    const candidates = shapes(...pair);
    let best: { points: Point[]; cost: number } | undefined;
    for (const points of candidates) {
      const value = blocked(points, obstaclesFor(edge), edge) ? undefined : cost(points, others);
      if (value !== undefined && (!best || value < best.cost)) best = { points, cost: value };
    }
    if (best) return { points: best.points, via: 'shape' };
    const lane = late() ? undefined : lanes(edge, pair, others);
    if (lane) return { points: lane, via: 'lanes' };
    const searched = search(edge, pair, routed, others);
    if (searched) return { points: searched, via: 'search' };
    const badness = (points: Point[]) => {
      const { crossings, conflicts } = against(points, others);
      return blocked(points, obstaclesFor(edge, false), edge) * 1e4 + conflicts * 1e3 + crossings * CROSS + bends(points) * BEND;
    };
    const pool = candidates.length ? candidates : [forcedRoute(...pair)];
    return { points: pool.reduce((p, q) => (badness(q) < badness(p) ? q : p)), via: 'forced' };
  };

  // Every port's first STUB, reserved until its own edge is routed so no route seals another port in.
  const stubsOf = (pair: [End, End]): Seg[] => pair.map(end => {
    const at = port(end.node, end.side, end.c), n = normal(end.side);
    return { a: at, b: { ...at, [n.axis]: at[n.axis] + n.sign * STUB } };
  });

  // Routes the edges in order, each against those before it and the stubs of those after it.
  const routeInOrder = (order: DiagramEdge[], ends: Map<string, [End, End]>, routes = new Map<string, Route>()) => {
    order.forEach((edge, index) => {
      const reserved = order.slice(index + 1).flatMap(other => stubsOf(ends.get(other.id)!));
      routes.set(edge.id, routeOne(edge, ends.get(edge.id)!, [...routes.values()].map(route => route.points), reserved));
    });
    return routes;
  };

  type Result = { routes: Map<string, Route>; ends: Map<string, [End, End]>; cost: number };
  const route = (banned: Map<string, Set<string>>): Result => {
    const ends = assignPorts(chooseSides(banned));
    // Routing order: edges whose best clear shape has the fewest bends first, then the shortest; edges with none last.
    const rank = (edge: DiagramEdge) => {
      const clear = shapes(...ends.get(edge.id)!).filter(points => !blocked(points, obstaclesFor(edge), edge));
      return clear.length ? Math.min(...clear.map(points => bends(points) * 1e5 + length(points))) : 1e9;
    };
    const order = routable.map(edge => ({ edge, rank: rank(edge) })).sort((a, b) => a.rank - b.rank).map(({ edge }) => edge);
    const routes = routeInOrder(order, ends);
    return { routes, ends, cost: totalCost(routes) };
  };

  // Rip-up and reroute, once per arrow that crosses another or was forced: remove it and every arrow it touches,
  // route it first, then the removed ones in their old order. Keep the change only when the total cost drops.
  const ripUp = ({ routes, ends, cost: total }: Result): Result => {
    for (const edge of routable) {
      if (late()) break;
      const own = segs(routes.get(edge.id)!.points);
      const touched = routable.filter(other => other !== edge && segs(routes.get(other.id)!.points).some(q => own.some(p => relation(p, q) !== 'none')));
      if (routes.get(edge.id)!.via !== 'forced' && !touched.some(other => against(routes.get(other.id)!.points, own).crossings)) continue;
      const kept = new Map([...routes].filter(([id]) => id !== edge.id && !touched.some(other => other.id === id)));
      const next = routeInOrder([edge, ...touched], ends, kept);
      const value = totalCost(next);
      if (value < total) { routes = next; total = value; }
    }
    return { routes, ends, cost: total };
  };

  // Two arrows that share a card side and cross each other swap their ports on it and are rerouted,
  // kept only when the total cost drops: ports ordered by the far card's angle misjudge arrows that bend round.
  const swapPorts = ({ routes, ends, cost: total }: Result): Result => {
    const key = (end: End) => `${end.node.id}|${end.side}`;
    for (const edge of routable) for (const other of routable) {
      if (late()) return { routes, ends, cost: total };
      if (edge.id >= other.id || !against(routes.get(edge.id)!.points, segs(routes.get(other.id)!.points)).crossings) continue;
      for (const role of [0, 1] as const) for (const otherRole of [0, 1] as const) {
        const mine = ends.get(edge.id)!, theirs = ends.get(other.id)!;
        if (key(mine[role]) !== key(theirs[otherRole])) continue;
        const swapped = new Map(ends);
        swapped.set(edge.id, role ? [mine[0], theirs[otherRole]] : [theirs[otherRole], mine[1]]);
        swapped.set(other.id, otherRole ? [theirs[0], mine[role]] : [mine[role], theirs[1]]);
        const kept = new Map([...routes].filter(([id]) => id !== edge.id && id !== other.id));
        const next = routeInOrder([edge, other], swapped, kept);
        const value = totalCost(next);
        if (value < total) { routes = next; ends = swapped; total = value; }
      }
    }
    return { routes, ends, cost: total };
  };

  // Edges that needed the grid search or failed try their next-best sides while that lowers the total cost.
  const banned = new Map<string, Set<string>>();
  let best = route(banned);
  for (let round = 1; round < ROUNDS && !late(); round++) {
    const hard = routable.filter(edge => best.routes.get(edge.id)!.via === 'search' || best.routes.get(edge.id)!.via === 'forced');
    if (!hard.length) break;
    for (const edge of hard) {
      const [S, T] = best.ends.get(edge.id)!;
      banned.set(edge.id, new Set([...(banned.get(edge.id) ?? []), `${S.side}|${T.side}`]));
    }
    const next = route(banned);
    if (next.cost >= best.cost) break;
    best = next;
  }
  best = ripUp(best);
  best = swapPorts(best);
  // An arrow still forced gets one last lane search, against the arrows already drawn clear, that may touch
  // other arrows but never runs on top of one or through a card.
  const forced = new Set(routable.filter(edge => best.routes.get(edge.id)!.via === 'forced').map(edge => edge.id));
  for (const edge of routable) {
    if (!forced.delete(edge.id) || late()) continue;
    const others = [...best.routes].filter(([id]) => id !== edge.id && !forced.has(id)).flatMap(([, other]) => segs(other.points));
    const found = laneSearch(...best.ends.get(edge.id)!, obstaclesFor(edge, false), others, bounds, { ...budget, lanes: Infinity }, true);
    if (found && !blocked(found, obstaclesFor(edge, false), edge)) best.routes.set(edge.id, { points: found, via: cost(found, others) === undefined ? 'forced' : 'lanes' });
  }

  const routed: RoutedEdge[] = edges.map(edge => {
    const route = best.routes.get(edge.id);
    return { ...edge, points: route?.points ?? [], unrouted: !route || route.via === 'forced' || undefined };
  });
  const labelsFrom = work, labelsUntil = performance.now() + LABEL_MS;
  const labelsLate = () => (work - labelsFrom > LABEL_WORK && performance.now() > labelsUntil);
  // Lane states shared by every label's reroute in this view.
  const rerouteBudget: Budget = { lanes: 4 * LANE_SEARCH_STATES, search: 0, late: labelsLate };
  const reroute = (edge: DiagramEdge, S: End, T: End, avoid: Obstacle[], others: Seg[]) =>
    laneSearch(S, T, [...obstaclesFor(edge), ...avoid], others, bounds, rerouteBudget);
  placeLabels(routed, labelSizes, cards, headers, groups, best.ends, obstaclesFor, reroute, labelsLate);
  for (const edge of routed) {
    const [before, last] = edge.points.slice(-2);
    if (before && last) edge.points[edge.points.length - 1] = last.x === before.x
      ? { ...last, y: last.y - Math.sign(last.y - before.y) * ARROW_INSET }
      : { ...last, x: last.x - Math.sign(last.x - before.x) * ARROW_INSET };
  }
  for (const edge of routed) edge.path = edgePath(edge.points, hops(edge, routed), edge.labelBox);
  return routed;
}

// Fewest-cost orthogonal path over a sparse lane grid: lanes run just outside every obstacle and CLEAR + 2 off every
// other arrow. Cost is length, bends, and crossings; running alongside another arrow or through a box is impossible.
// Gives up (undefined) when the grid is too big or this search or the view runs out of states to expand.
// `touching` lets the route run alongside or touch other arrows at a high cost, as a last resort.
function laneSearch(S: End, T: End, obstacles: Obstacle[], others: Seg[], bounds: Box, budget: Budget, touching = false): Point[] | undefined {
  if (budget.lanes <= 0) return undefined;
  const start = port(S.node, S.side, S.c), end = port(T.node, T.side, T.c);
  const nS = normal(S.side), nT = normal(T.side);
  const padded = (box: Box): Box => ({ x: box.x - PAD, y: box.y - PAD, width: box.width + 2 * PAD, height: box.height + 2 * PAD });
  const boxes = [...obstacles.filter(box => box !== S.node && box !== T.node), S.node, T.node].map(padded);
  const [sourceBox, targetBox] = boxes.slice(-2);
  // The run straight out of a port may pass its own card's padding.
  const outward = (a: Point, b: Point, at: Point, n: { axis: Axis; sign: number }) =>
    a[across(n.axis)] === at[across(n.axis)] && b[across(n.axis)] === at[across(n.axis)]
    && (n.sign > 0 ? Math.min(a[n.axis], b[n.axis]) >= at[n.axis] : Math.max(a[n.axis], b[n.axis]) <= at[n.axis]);
  const exempt = (box: Box, a: Point, b: Point) => (box === sourceBox && outward(a, b, start, nS)) || (box === targetBox && outward(a, b, end, nT));
  const lo = { x: bounds.x, y: bounds.y }, hi = { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
  const lanesOn = (axis: Axis) => {
    const values = [start[axis], end[axis], start[axis] + (nS.axis === axis ? nS.sign * STUB : 0), end[axis] + (nT.axis === axis ? nT.sign * STUB : 0), lo[axis], hi[axis]];
    for (const box of boxes) values.push(box[axis] - 4, box[axis] + box[span(axis)] + 4);
    // A vertical arrow sits on an x lane; parallel neighbours keep CLEAR + 2 from it.
    for (const { a, b } of others) if (a[axis] === b[axis]) values.push(a[axis] - CLEAR - 2, a[axis] + CLEAR + 2);
    // A lane on (or beside) another arrow's line could only be crossed by touching that arrow, so drop it.
    const taken = others.filter(({ a, b }) => a[axis] === b[axis]).map(({ a }) => a[axis]);
    const sorted = [...new Set(values.filter((value, index) => value >= lo[axis] && value <= hi[axis]
      && (index < 4 || touching || taken.every(at => Math.abs(at - value) >= CLEAR))))].sort((p, q) => p - q);
    const mids = sorted.slice(1).flatMap((value, index) => value - sorted[index] > 48 ? [(value + sorted[index]) / 2] : []);
    return [...new Set([...sorted, ...mids])].sort((p, q) => p - q);
  };
  const xs = lanesOn('x'), ys = lanesOn('y');
  const X = xs.length, Y = ys.length, V = X * Y;
  const si = xs.indexOf(start.x), sj = ys.indexOf(start.y);
  const ti = xs.indexOf(end.x), tj = ys.indexOf(end.y);
  let states = touching ? V * 4 : LANE_SEARCH_STATES;
  // A last-resort route may turn closer to its cards, so two arrows facing each other across a narrow gap both fit.
  const stub = touching ? STUB / 2 : STUB;
  if (si < 0 || sj < 0 || ti < 0 || tj < 0 || V > 40_000) return undefined;
  // Step cost from vertex (i, j) to its +x or +y neighbour, computed on first use; Infinity when blocked.
  const { seen, dist, parent, done, stepSeen, steps } = claimScratch(V * 4), epoch = scratch.epoch;
  const distOf = (state: number) => (seen[state] === epoch ? dist[state] : Infinity);
  // Boxes and arrows that can touch a step along one grid line, found once per line.
  const lines = new Map<string, [Box[], Seg[]]>();
  const line = (axis: Axis, index: number): [Box[], Seg[]] => {
    const key = axis + index;
    const cached = lines.get(key);
    if (cached) return cached;
    const ac = across(axis), at = (ac === 'y' ? ys : xs)[index];
    work += boxes.length + others.length;
    const found: [Box[], Seg[]] = [
      boxes.filter(box => box[ac] < at && at < box[ac] + box[span(ac)]),
      others.filter(({ a, b }) => a[ac] === b[ac] ? Math.abs(a[ac] - at) < CLEAR : Math.min(a[ac], b[ac]) - 4 <= at && at <= Math.max(a[ac], b[ac]) + 4),
    ];
    lines.set(key, found);
    return found;
  };
  const step = (id: number, axis: Axis): number => {
    const key = id * 2 + (axis === 'y' ? 1 : 0);
    if (stepSeen[key] === epoch) return steps[key];
    const i = id % X, j = (id / X) | 0;
    const a = { x: xs[i], y: ys[j] }, b = { x: xs[axis === 'x' ? i + 1 : i], y: ys[axis === 'y' ? j + 1 : j] };
    let value = (b.x - a.x + b.y - a.y) * LENGTH;
    const [lineBoxes, lineOthers] = line(axis, axis === 'x' ? j : i);
    for (const box of lineBoxes) if (hitsBox(a, b, box, 0) && !exempt(box, a, b)) { value = Infinity; break; }
    if (value < Infinity) for (const other of lineOthers) {
      const kind = relation({ a, b }, other);
      // Touching may run beside another arrow, never on top of it.
      if (kind === 'conflict' && (!touching || (a.x === b.x ? other.a.x === other.b.x && other.a.x === a.x : other.a.y === other.b.y && other.a.y === a.y))) { value = Infinity; break; }
      if (kind === 'conflict') value += TOUCH;
      if (kind === 'cross') value += CROSS;
    }
    stepSeen[key] = epoch;
    return (steps[key] = value);
  };
  // State = vertex * 4 + heading (0 +x, 1 -x, 2 +y, 3 -y).
  const heading = (axis: Axis, sign: number) => (axis === 'x' ? 0 : 2) + (sign > 0 ? 0 : 1);
  const startHeading = heading(nS.axis, nS.sign), endHeading = heading(nT.axis, -nT.sign);
  // Admissible estimate of the cost left from a point moving in heading h: length plus the fewest bends
  // any orthogonal path needs to arrive in the end heading (same heading 0 or 2, opposite 2, across 1 or 3).
  const estimate = (x: number, y: number, h: number) => {
    const ax: Axis = h < 2 ? 'x' : 'y', sign = h % 2 ? -1 : 1, at = { x, y };
    const ahead = (end[ax] - at[ax]) * sign >= 0;
    let turns: number;
    if (h === endHeading) turns = ahead && at[across(ax)] === end[across(ax)] ? 0 : 2;
    else if ((h ^ 1) === endHeading) turns = 2;
    else turns = ahead && (end[across(ax)] - at[across(ax)]) * (endHeading % 2 ? -1 : 1) > 0 ? 1 : 3;
    return LENGTH * (Math.abs(x - end.x) + Math.abs(y - end.y)) + turns * BEND;
  };
  const heap = new MinHeap();
  const origin = (sj * X + si) * 4 + startHeading, goal = (tj * X + ti) * 4 + endHeading;
  seen[origin] = epoch;
  dist[origin] = 0;
  parent[origin] = -1;
  heap.push(origin, 0);
  while (heap.size) {
    const state = heap.pop();
    if (done[state] === epoch) continue;
    if (--budget.lanes < 0 || --states < 0 || ((states & 255) === 0 && budget.late())) return undefined;
    done[state] = epoch;
    const sofar = dist[state];
    if (state === goal) break;
    const id = state >> 2, h = state & 3, i = id % X, j = (id / X) | 0;
    // No turn within STUB of the start port, and the final run into the target is at least STUB long.
    const nearStart = h === startHeading && Math.abs(xs[i] - start.x) + Math.abs(ys[j] - start.y) < stub && (nS.axis === 'x' ? ys[j] === start.y : xs[i] === start.x);
    for (let nh = 0; nh < 4; nh++) {
      if ((nh ^ 1) === h) continue;
      if (nh !== h && nearStart) continue;
      const ni = nh === 0 ? i + 1 : nh === 1 ? i - 1 : i, nj = nh === 2 ? j + 1 : nh === 3 ? j - 1 : j;
      if (ni < 0 || nj < 0 || ni >= X || nj >= Y) continue;
      const stepCost = nh === 0 ? step(id, 'x') : nh === 1 ? step(id - 1, 'x') : nh === 2 ? step(id, 'y') : step(id - X, 'y');
      if (stepCost === Infinity) continue;
      if (nh !== h && nh === endHeading && (nT.axis === 'x' ? ys[j] === end.y : xs[i] === end.x) && Math.abs(xs[i] - end.x) + Math.abs(ys[j] - end.y) < stub) continue;
      const next = (nj * X + ni) * 4 + nh, total = sofar + stepCost + (nh !== h ? BEND : 0);
      // Among equal estimates, expand the state furthest along first.
      if (total < distOf(next)) { seen[next] = epoch; dist[next] = total; parent[next] = state; heap.push(next, total + estimate(xs[ni], ys[nj], nh) - total * 1e-6); }
    }
  }
  if (distOf(goal) === Infinity) return undefined;
  const points: Point[] = [];
  for (let state = goal; state >= 0; state = parent[state]) points.push({ x: xs[(state >> 2) % X], y: ys[((state >> 2) / X) | 0] });
  return simplifyRoute(points.reverse());
}

// Arrays every lane search reuses, so a search costs what it expands rather than its whole grid.
// An entry counts only while its stamp equals the current search's epoch.
const scratch = {
  epoch: 0, seen: new Uint32Array(0), dist: new Float64Array(0), parent: new Int32Array(0), done: new Uint32Array(0),
  stepSeen: new Uint32Array(0), steps: new Float64Array(0),
};
function claimScratch(states: number): typeof scratch {
  if (scratch.seen.length < states) Object.assign(scratch, {
    epoch: 0, seen: new Uint32Array(states), dist: new Float64Array(states), parent: new Int32Array(states), done: new Uint32Array(states),
    stepSeen: new Uint32Array(states / 2), steps: new Float64Array(states / 2),
  });
  scratch.epoch++;
  return scratch;
}

// Binary min-heap of values by key, in two flat arrays so pushes allocate nothing per item.
class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];
  get size() { return this.keys.length; }
  push(value: number, key: number) {
    const { keys, values } = this;
    let k = keys.length;
    for (; k > 0;) {
      const p = (k - 1) >> 1;
      if (keys[p] <= key) break;
      keys[k] = keys[p];
      values[k] = values[p];
      k = p;
    }
    keys[k] = key;
    values[k] = value;
  }
  pop(): number {
    const { keys, values } = this, top = values[0], key = keys.pop()!, value = values.pop()!;
    const n = keys.length;
    if (n) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (key <= keys[c]) break;
        keys[k] = keys[c];
        values[k] = values[c];
        k = c;
      }
      keys[k] = key;
      values[k] = value;
    }
    return top;
  }
}

function forcedRoute(S: End, T: End): Point[] {
  const start = port(S.node, S.side, S.c), end = port(T.node, T.side, T.c);
  const nS = normal(S.side), nT = normal(T.side);
  const a = { ...start, [nS.axis]: start[nS.axis] + nS.sign * STUB }, b = { ...end, [nT.axis]: end[nT.axis] + nT.sign * STUB };
  return simplifyRoute([start, a, { x: a.x, y: b.y }, b, end]);
}

// Labels last: centred on the longest straight run, then slid along it, then across a vertical run.
// When nothing fits, the edge may switch to another clear shape whose runs fit, move one middle run sideways,
// or lift a stretch of a run clear of its neighbours, until the label sits centred on it in free space; otherwise
// the label is flagged and sits on its own arrow where it misses cards and other labels, else on the longest run.
function placeLabels(edges: RoutedEdge[], labelSizes: Record<string, Size>, cards: DiagramNode[], headers: Obstacle[], groups: DiagramNode[],
  ends: Map<string, [End, End]>, obstaclesFor: (edge: DiagramEdge) => Obstacle[],
  reroute: (edge: DiagramEdge, S: End, T: End, avoid: Obstacle[], others: Seg[]) => Point[] | undefined, late: () => boolean): void {
  const taken: Box[] = [...cards, ...headers];
  const separate = (a: Box, b: Box) => a.x + a.width + PAD <= b.x || b.x + b.width + PAD <= a.x || a.y + a.height + PAD <= b.y || b.y + b.height + PAD <= a.y;
  const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  const apart = (a: Box, b: Box) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  // Fallback fits for a label no clear spot takes, still off cards and labels: `tight` drops the padding and lets the
  // label cover more of its own arrow but no other arrow; `any` also ignores other arrows (their lines hide under it).
  type Fit = 'clear' | 'tight' | 'any';
  // Past the deadline nothing fits, so every search below ends at once.
  const fits = (box: Box, edge: RoutedEdge, points: Point[], fit: Fit) => !late()
    && taken.every(other => (fit === 'clear' ? separate : apart)(box, other))
    && groups.every(group => inside(box, group) || apart(box, group))
    && (fit === 'any' || edges.every(other => other === edge || !segs(other.points).some(({ a, b }) => hitsBox(a, b, box, fit === 'clear' ? PAD : 0))))
    && (fit !== 'clear' || segs(points).filter(({ a, b }) => hitsBox(a, b, box, PAD)).length <= 1);
  const spot = (edge: RoutedEdge, points: Point[], size: Size, fit: Fit = 'clear'): Box | undefined => {
    const loose = fit !== 'clear';
    const runs = segs(points).sort((p, q) => length([q.a, q.b]) - length([p.a, p.b]));
    const tiers: Box[][] = [[], [], []];
    for (const { a, b } of runs) {
      const ax: Axis = a.y === b.y ? 'x' : 'y';
      const extent = ax === 'x' ? size.width : size.height;
      const lo = Math.min(a[ax], b[ax]) + extent / 2 + CORNER + 2, hi = Math.max(a[ax], b[ax]) - extent / 2 - CORNER - 2;
      const box = (at: number, shift = 0) => ({
        x: (ax === 'x' ? at : a.x + shift) - size.width / 2, y: (ax === 'y' ? at : a.y + shift) - size.height / 2, width: size.width, height: size.height,
      });
      if (loose) {
        // Any run, even one shorter than the label, anywhere the label still straddles or touches it.
        const half = (ax === 'x' ? size.height : size.width) / 2 + 4;
        for (const shift of samples(-half, half, 8, Infinity)) tiers[2].push(...samples(a[ax], b[ax], 8, Infinity).map(at => box(at, shift)));
        continue;
      }
      if (lo > hi) continue;
      const positions = samples(lo, hi, 8, Infinity);
      tiers[0].push(box(positions[0]));
      tiers[1].push(...positions.slice(1).map(at => box(at)));
      if (ax === 'y') for (const at of positions) for (const shift of samples(18 - size.width / 2, size.width / 2 - 18, 16).slice(1)) tiers[2].push(box(at, shift));
    }
    return tiers.flat().find(candidate => fits(candidate, edge, points, fit));
  };
  const sizeOf = (edge: RoutedEdge) => labelSize(edge, labelSizes);
  const unplaced: RoutedEdge[] = [];
  for (const edge of edges) {
    if (!edge.label || edge.points.length < 2) continue;
    const found = late() ? undefined : spot(edge, edge.points, sizeOf(edge));
    if (found) { edge.labelBox = { ...found, lines: wrapLabel(edge.label) }; taken.push(found); }
    else unplaced.push(edge);
  }
  // Past the deadline a label skips the searches below and sits flagged on the middle of its longest run.
  for (const edge of unplaced) {
    const size = sizeOf(edge);
    const pair = late() ? undefined : ends.get(edge.id);
    const others = edges.filter(other => other !== edge).flatMap(other => segs(other.points));
    const labels = edges.flatMap(other => other.labelBox ? [{ ...other.labelBox, id: other.id }] : []);
    // Local adjustment: keep this edge's ports, or move an end to the middle of a side no other arrow uses.
    const used = new Set([...ends].filter(([id]) => id !== edge.id).flatMap(([, ends]) => ends.map(end => `${end.node.id}|${end.side}`)));
    const options = (end: End): End[] => [end, ...SIDES.filter(side => side !== end.side && !used.has(`${end.node.id}|${side}`)).map(side => middleEnd(end.node, side))];
    const alternatives = (pair ? [...options(pair[0]).flatMap(S => options(pair[1]).flatMap(T => shapes(S, T))), ...moved(edge.points, size)] : [])
      .flatMap(points => {
        const value = blocked(points, [...obstaclesFor(edge), ...labels], edge) ? undefined : cost(points, others);
        return value === undefined ? [] : [{ points, value }];
      })
      .sort((p, q) => p.value - q.value);
    const placed = alternatives.find(({ points }) => {
      const found = spot(edge, points, size);
      if (!found) return false;
      edge.points = points;
      edge.labelBox = { ...found, lines: wrapLabel(edge.label) };
      taken.push(found);
      return true;
    });
    if (placed) continue;
    // Else lift a stretch of the arrow clear of the arrows beside it, crossing no more arrows, and centre the label there.
    const crossings = against(edge.points, others).crossings;
    const lifted = (pair ? detours(edge.points, size) : [])
      .flatMap(({ points, box }) => {
        const value = blocked(points, [...obstaclesFor(edge), ...labels], edge) || !fits(box, edge, points, 'clear')
          || against(points, others).crossings > crossings ? undefined : cost(points, others);
        return value === undefined ? [] : [{ points, box, value }];
      })
      .reduce<{ points: Point[]; box: Box; value: number } | undefined>((best, option) => (!best || option.value < best.value ? option : best), undefined);
    // Else search a new route, crossing no more arrows, that keeps out of the middle of every run the label found no room beside.
    const avoid = segs(edge.points).flatMap(({ a, b }): Obstacle[] => {
      const lo = (axis: Axis) => Math.min(a[axis], b[axis]) + 2 * STUB, hi = (axis: Axis) => Math.max(a[axis], b[axis]) - 2 * STUB;
      const box = a.y === b.y ? { x: lo('x'), y: a.y - CLEAR, width: hi('x') - lo('x'), height: 2 * CLEAR } : { x: a.x - CLEAR, y: lo('y'), width: 2 * CLEAR, height: hi('y') - lo('y') };
      return box.width > 0 && box.height > 0 ? [{ ...box, id: '' }] : [];
    });
    const rerouted = lifted ?? (pair && avoid.length ? options(pair[0]).flatMap(S => options(pair[1]).map(T => late() ? undefined : reroute(edge, S, T, [...avoid, ...labels], others))) : [])
      .flatMap(points => {
        const value = points && against(points, others).crossings <= crossings ? cost(points, others) : undefined;
        const box = points && value !== undefined ? spot(edge, points, size) : undefined;
        return points && box && value !== undefined ? [{ points, box, value }] : [];
      })
      .reduce<{ points: Point[]; box: Box; value: number } | undefined>((best, option) => (!best || option.value < best.value ? option : best), undefined);
    if (rerouted) {
      edge.points = rerouted.points;
      edge.labelBox = { ...rerouted.box, lines: wrapLabel(edge.label) };
      taken.push(rerouted.box);
      continue;
    }
    const { a, b } = segs(edge.points).sort((p, q) => length([q.a, q.b]) - length([p.a, p.b]))[0];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const loose = pair && (spot(edge, edge.points, size, 'tight') ?? spot(edge, edge.points, size, 'any'));
    const box = loose ?? { x: mid.x - size.width / 2, y: mid.y - size.height / 2, width: size.width, height: size.height };
    edge.labelBox = { ...box, lines: wrapLabel(edge.label) };
    if (loose) taken.push(loose);
    edge.labelUnplaced = true;
  }
}

// Routes with one stretch of a run lifted sideways in lane steps, far enough that the label centred on it can clear
// arrows running alongside. A stretch that reaches a bend moves the bend instead of stepping back. Ports and the
// runs at the cards keep their direction and at least STUB; no run folds back on itself.
function detours(points: Point[], size: Size): { points: Point[]; box: Box }[] {
  const runs = segs(points), out: { points: Point[]; box: Box }[] = [];
  runs.forEach(({ a, b }, index) => {
    const ax: Axis = a.y === b.y ? 'x' : 'y', ac = across(ax), dir = Math.sign(b[ax] - a[ax]);
    const along = ax === 'x' ? size.width : size.height, half = (ax === 'x' ? size.height : size.width) / 2;
    const w = along + 2 * (CORNER + 4);
    const first = index === 0, last = index === runs.length - 1;
    const start = a[ax] + dir * (first ? STUB : 0), end = b[ax] - dir * (last ? STUB : 0);
    if ((end - start) * dir < w) return;
    const stretches: [number, number][] = [];
    if (!first) stretches.push([a[ax], a[ax] + dir * w]);
    if (!last) stretches.push([b[ax] - dir * w, b[ax]]);
    for (let from = start; (end - from) * dir >= w; from += dir * 24) stretches.push([from, from + dir * w]);
    for (const [from, to] of stretches) for (let k = 0; k < 8; k++) for (const sign of [-1, 1]) {
      const delta = sign * (half + PAD + k * CLEAR);
      const at = (value: number, shift: number): Point => ({ [ax]: value, [ac]: a[ac] + shift } as Point);
      const route = simplifyRoute([
        ...points.slice(0, index + 1), at(from, 0), at(from, delta), at(to, delta), at(to, 0), ...points.slice(index + 1),
      ]);
      const ends = segs(route);
      const keeps = (run: Seg, was: Seg) => {
        const axis: Axis = was.a.y === was.b.y ? 'x' : 'y', now = run.b[axis] - run.a[axis];
        return run.a[across(axis)] === run.b[across(axis)] && Math.sign(now) === Math.sign(was.b[axis] - was.a[axis]) && Math.abs(now) >= STUB;
      };
      const folds = ends.slice(1).some((run, i) => (run.b.x - run.a.x) * (ends[i].b.x - ends[i].a.x) + (run.b.y - run.a.y) * (ends[i].b.y - ends[i].a.y) < 0);
      if (folds || !keeps(ends[0], runs[0]) || !keeps(ends.at(-1)!, runs.at(-1)!)) continue;
      const centre = at((from + to) / 2, delta);
      out.push({ points: route, box: { x: centre.x - size.width / 2, y: centre.y - size.height / 2, width: size.width, height: size.height } });
    }
  });
  return out;
}

// The route with one middle run moved sideways by at least half the label's size across it, in lane steps.
// Every run keeps its direction, and the runs at the cards keep at least STUB.
function moved(points: Point[], size: Size): Point[][] {
  const runs = segs(points);
  const keepsShape = (route: Point[]) => segs(route).every(({ a, b }, index) => {
    const ax: Axis = a.x === b.x ? 'y' : 'x', was = runs[index].b[ax] - runs[index].a[ax], now = b[ax] - a[ax];
    return Math.sign(now) === Math.sign(was) && Math.abs(now) >= (index === 0 || index === runs.length - 1 ? STUB : 1);
  });
  return runs.slice(1, -1).flatMap(({ a, b }, index) => {
    const ax: Axis = a.x === b.x ? 'x' : 'y', half = (ax === 'x' ? size.width : size.height) / 2 + PAD;
    return [-1, 1].flatMap(sign => Array.from({ length: 12 }, (_, k) => sign * (half + k * CLEAR)))
      .map(delta => points.map((point, at) => (at === index + 1 || at === index + 2 ? { ...point, [ax]: point[ax] + delta } : point)));
  }).filter(keepsShape);
}

// Points where another edge's vertical run crosses this edge's horizontal runs, drawn as hops.
function hops(edge: DiagramEdge, edges: DiagramEdge[]): Point[] {
  const hits: Point[] = [];
  for (const { a, b } of segs(edge.points)) {
    if (a.y !== b.y) continue;
    const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    for (const other of edges) {
      if (other === edge) continue;
      for (const { a: c, b: d } of segs(other.points)) {
        if (c.x !== d.x) continue;
        if (c.x > left + 6 && c.x < right - 6 && a.y > Math.min(c.y, d.y) + 1 && a.y < Math.max(c.y, d.y) - 1) hits.push({ x: c.x, y: a.y });
      }
    }
  }
  return hits;
}
