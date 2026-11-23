import type { DiagramOrientation } from '../lib/alignment-packs.js';
import type { Diagram, DiagramNode, MeasuredGeometry, Point } from './alignment-graph.js';

// Container placement: each container (the top level and every expanded group) is laid out alone,
// deepest first, and its parent treats it as one fixed-size box. Inside a container, children are
// ranked along the flow, ordered across it, and the ranks wrapped into bands to fit the screen.

const CARD_GAP = 32;
const RANK_GAP = 48;
const BAND_GAP = 64;
const PAD = 40;
const LABEL_MARGIN = 16;
// Room per arrow running through a gap: the router keeps arrows 12 px apart and 8 px off cards.
const LANE = 12;
const TARGET_RATIO = 1.6;
// A kept band count survives until its shape scores this much worse than the best one.
const KEEP_BANDS_SLACK = 4;
// Whole-diagram barycentre passes; the one with the fewest crossings is kept.
const SWEEPS = 6;
// Each link split across bands costs this fraction of the fit score: a turn back costs bends and crossings.
const CROSS_BAND_COST = 0.35;
// A band keeps its cards' previous places while it stays within this factor of its packed width,
// squeezing those places towards its edge up to this many times before packing instead.
const KEEP_SLACK = 1.05;
const SQUEEZES = 4;
// How kept places make room as cards resize: stretched across the resized card's old span, or with only the resized
// card changing, keeping its centre, near edge, or far edge. The one keeping the most cards on their sides wins.
type Anchor = 'stretch' | number;
const ANCHORS: Anchor[] = ['stretch', 0.5, 0, 1];
const LEVEL = 40;
// A diagram keeps previous places or order while it stays within this factor of a fresh layout's
// width and height; a previous order merely used as the sweeps' start gets the looser factor.
const FIT_SLACK = 1.05;
const SEEDED_SLACK = 1.1;

export type PlacedDiagram = Diagram & { bands: Record<string, number> };

type Link = { from: string; to: string; label: { main: number; cross: number } };
// One container's children, ranked along the flow; order inside a rank is decided per layout.
type Ranked = { ranks: string[][]; links: Link[]; gaps: number[] };
type Layout = { width: number; height: number; bands: number; at: Map<string, Point> };
type Placed = { nodes: DiagramNode[]; bands: Record<string, number> };
type Need = { before: string; after: string; gap: number };

/**
 * Places every node of a projected diagram: absolute x, y, width and height, groups sized around
 * their children. Edges are returned unchanged. `bands` records how many bands each container
 * (`''` for the top level) wrapped into; passing it back as `previous` keeps those counts unless
 * a kept count fits the screen more than 4 times worse than the best. Previous node positions,
 * when given, keep the cards' order across the flow and, where it costs little room, their place
 * across it. The result is never more than 5% wider or taller than a fresh layout (8% when only the
 * order is kept as a starting point); past that it is the fresh layout, so repeated toggles cannot grow it.
 */
export function placeDiagram(projection: Diagram, measured: MeasuredGeometry, orientation: DiagramOrientation, previous?: { bands?: Record<string, number>; nodes?: DiagramNode[] }): PlacedDiagram {
  const horizontal = orientation === 'left-to-right';
  const byId = new Map(projection.nodes.map(node => [node.id, node]));
  const parentOf = (id: string): string => {
    const parent = byId.get(id)?.parentId;
    return parent && byId.has(parent) ? parent : '';
  };
  const kidsOf = new Map<string, string[]>([['', []]]);
  for (const node of projection.nodes) kidsOf.set(parentOf(node.id), [...(kidsOf.get(parentOf(node.id)) ?? []), node.id]);
  const isContainer = (id: string) => id === '' || byId.get(id)?.kind === 'group';
  // Every node's ancestors, nearest first, ending with the top level.
  const chains = new Map(projection.nodes.map(node => {
    const chain = [node.id];
    while (chain.at(-1) !== '') chain.push(parentOf(chain.at(-1)!));
    return [node.id, chain];
  }));
  const childOf = (container: string, id: string): string | undefined => {
    const chain = chains.get(id);
    const index = chain?.indexOf(container) ?? -1;
    return index > 0 ? chain![index - 1] : undefined;
  };
  const edges = projection.edges.filter(edge => byId.has(edge.source) && byId.has(edge.target));
  const own = (id: string) => measured.nodes[id] ?? { width: byId.get(id)!.width, height: byId.get(id)!.height };
  const header = (id: string) => own(id).height;
  const main = (size: { width: number; height: number }) => (horizontal ? size.width : size.height);
  const cross = (size: { width: number; height: number }) => (horizontal ? size.height : size.width);

  // Each card's previous centre and size across the flow, when it sat in the same container.
  const before = new Map((previous?.nodes ?? []).map(node => [node.id, node]));
  const was = new Map(projection.nodes.flatMap(node => {
    const old = before.get(node.id);
    return old && old.parentId === node.parentId ? [[node.id, { centre: cross(old) / 2 + (horizontal ? old.y : old.x), size: cross(old) }] as const] : [];
  }));

  const ranked = new Map<string, Ranked>();
  // Every group gets a layout, including an expanded group with no visible children.
  for (const container of ['', ...projection.nodes.filter(node => isContainer(node.id)).map(node => node.id)]) {
    const links: Link[] = [];
    const external = new Map<string, { in: number; out: number }>();
    for (const edge of edges) {
      const from = childOf(container, edge.source), to = childOf(container, edge.target);
      if (from && !to) external.set(from, { in: external.get(from)?.in ?? 0, out: (external.get(from)?.out ?? 0) + 1 });
      if (to && !from) external.set(to, { in: (external.get(to)?.in ?? 0) + 1, out: external.get(to)?.out ?? 0 });
      if (from && to && from !== to) {
        const label = measured.labels[edge.id] ?? { width: 0, height: 0 };
        links.push({ from, to, label: { main: main(label), cross: cross(label) } });
      }
    }
    ranked.set(container, rankChildren(kidsOf.get(container) ?? [], links, external));
  }

  // Lays out every container deepest first, ordering each rank by `key` where one is known.
  const layoutAll = (key: Map<string, number>, places: typeof was, centred = false, anchor: Anchor = 'stretch') => {
    const size = new Map<string, { width: number; height: number }>();
    const layouts = new Map<string, Layout>();
    const layout = (container: string) => {
      for (const kid of kidsOf.get(container) ?? []) {
        if (!isContainer(kid)) { size.set(kid, own(kid)); continue; }
        layout(kid);
        const inner = layouts.get(kid)!;
        size.set(kid, { width: Math.max(own(kid).width, inner.width + 2 * PAD), height: header(kid) + inner.height + 2 * PAD });
      }
      const sized = (id: string) => ({ main: main(size.get(id)!), cross: cross(size.get(id)!) });
      layouts.set(container, wrapRanks(ranked.get(container)!, sized, key, horizontal, previous?.bands?.[container], isContainer, centred, places, anchor));
    };
    layout('');
    const placed: DiagramNode[] = [];
    const position = (container: string, x: number, y: number) => {
      const { at } = layouts.get(container)!;
      for (const kid of kidsOf.get(container) ?? []) {
        const node: DiagramNode = { ...byId.get(kid)!, x: x + at.get(kid)!.x, y: y + at.get(kid)!.y, ...size.get(kid)! };
        placed.push(node);
        if (isContainer(kid)) {
          node.headerHeight = header(kid);
          position(kid, node.x + PAD, node.y + header(kid) + PAD);
        }
      }
    };
    position('', 0, 0);
    return { nodes: placed, bands: Object.fromEntries([...layouts].map(([id, placedLayout]) => [id, placedLayout.bands])) };
  };

  // Barycentre sweeps over the whole diagram: each node is ordered by where its neighbours sit,
  // including neighbours outside its container. Each sweep tries pulling by predecessors, by
  // successors, and by both (pulling both ends at once can swap two pairs and never settle),
  // follows the try with the fewest crossings, and the best layout seen wins.
  // A previous layout seeds the order and, while `pin` holds it, fixes it, so cards keep their places across a toggle.
  const seed = new Map((previous?.nodes ?? []).map(node => [node.id, horizontal ? node.y + node.height / 2 : node.x + node.width / 2]));
  const arrange = (places: typeof was, pin = seed, anchor: Anchor = 'stretch') => {
    const first = layoutAll(seed, places, false, anchor);
    // Every card gets a key, so new cards sort among seen ones by where the first pass placed them.
    const seedAll = new Map([...first.nodes.map(node => [node.id, horizontal ? node.y + node.height / 2 : node.x + node.width / 2] as const), ...seed]);
    let best = previous?.nodes ? layoutAll(seedAll, places, false, anchor) : first, fewest = straightCrossings(best.nodes, edges), bestKey = previous?.nodes ? seedAll : seed;
    let current = best;
    for (let sweep = 0; sweep < SWEEPS && fewest > 0; sweep++) {
      const tries = (['in', 'out', undefined] as const).map(pull => {
        const key = new Map([...barycentres(current.nodes, edges, chains, horizontal, pull), ...pin]);
        const placed = layoutAll(key, places, false, anchor);
        return { placed, key, crossings: straightCrossings(placed.nodes, edges) };
      });
      const pick = tries.reduce((winner, attempt) => (attempt.crossings < winner.crossings ? attempt : winner));
      current = pick.placed;
      if (pick.crossings < fewest) { best = current; fewest = pick.crossings; bestKey = pick.key; }
    }
    // The winning order, laid out again with children placed before their neighbours moved over them,
    // kept unless the move adds crossings. Cards in kept places do not move.
    const centred = layoutAll(bestKey, places, true, anchor);
    if (straightCrossings(centred.nodes, edges) <= fewest) best = centred;
    return best;
  };
  if (!previous?.nodes) {
    const placed = arrange(was);
    return { ...projection, nodes: placed.nodes, bands: placed.bands };
  }
  // Kept places (each way of resizing a card), kept order, and the previous order as a start, in that order of
  // preference; the one keeping the most cards on their previous sides of each other wins, and a fresh layout when
  // none stays near a fresh layout's size.
  const fresh = placeDiagram(projection, measured, orientation, { bands: previous.bands });
  const extent = (nodes: DiagramNode[]) => [Math.max(...nodes.map(node => node.x + node.width)) - Math.min(...nodes.map(node => node.x)), Math.max(...nodes.map(node => node.y + node.height)) - Math.min(...nodes.map(node => node.y))];
  const tries: [() => Placed, number][] = [
    ...ANCHORS.map((anchor): [() => Placed, number] => [() => arrange(was, seed, anchor), FIT_SLACK]),
    [() => arrange(new Map()), SEEDED_SLACK], [() => arrange(new Map(), new Map()), SEEDED_SLACK], [() => fresh, Infinity],
  ];
  let placed: Placed = fresh, most = -1;
  for (const [attempt, slack] of tries) {
    const candidate = attempt();
    if (!extent(candidate.nodes).every((length, axis) => length <= extent(fresh.nodes)[axis] * slack)) continue;
    const kept = orderKept({ nodes: previous.nodes }, candidate);
    if (kept > most) { placed = candidate; most = kept; }
    if (most === 1) break;
  }
  return { ...projection, nodes: placed.nodes, bands: placed.bands };
}

// Ranks along the flow by longest path with back links dropped; children talking only outward
// move to the last rank and children fed only from outside to the first.
function rankChildren(kids: string[], links: Link[], external: Map<string, { in: number; out: number }>): Ranked {
  const rank = new Map(kids.map(kid => [kid, 0]));
  const out = new Map(kids.map(kid => [kid, [] as string[]]));
  const hasIn = new Set(links.map(link => link.to)), hasOut = new Set(links.map(link => link.from));
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const link of links) {
      if (link.from !== id || state.get(link.to) === 'open') continue;
      out.get(id)!.push(link.to);
      if (!state.has(link.to)) visit(link.to);
    }
    state.set(id, 'done');
  };
  const indegree = (id: string) => links.filter(link => link.to === id).length;
  for (const kid of [...kids].sort((a, b) => indegree(a) - indegree(b))) if (!state.has(kid)) visit(kid);
  const order = topologicalOrder(kids, out);
  for (const id of order) for (const next of out.get(id)!) rank.set(next, Math.max(rank.get(next)!, rank.get(id)! + 1));
  // Sources sit just before their nearest successor so they do not all pile into rank 0.
  for (const id of [...order].reverse()) {
    const next = out.get(id)!;
    if (next.length && !hasIn.has(id)) rank.set(id, Math.min(...next.map(target => rank.get(target)!)) - 1);
  }
  const last = Math.max(0, ...rank.values());
  for (const kid of kids) {
    const outside = external.get(kid);
    if (outside && outside.out > outside.in && !hasOut.has(kid)) rank.set(kid, last);
    else if (outside && outside.in > outside.out && !hasIn.has(kid)) rank.set(kid, 0);
  }
  const sparse: string[][] = [];
  for (const kid of kids) (sparse[rank.get(kid)!] ??= []).push(kid);
  const ranks = sparse.filter(Boolean);
  const rankOf = new Map(ranks.flatMap((members, index) => members.map(id => [id, index] as const)));
  // The gap after each rank fits the labels leaving it and one lane per link passing through.
  const gaps = ranks.map((_, index) => {
    const touching = links.filter(link => Math.min(rankOf.get(link.from)!, rankOf.get(link.to)!) === index || Math.max(rankOf.get(link.from)!, rankOf.get(link.to)!) === index + 1);
    const passing = links.filter(link => Math.min(rankOf.get(link.from)!, rankOf.get(link.to)!) <= index && index < Math.max(rankOf.get(link.from)!, rankOf.get(link.to)!));
    // Back links count too; a back link joining the same two children shares their stretch, so its label stacks.
    const widest = stackedLabels(touching, 'main');
    return Math.max(RANK_GAP, widest ? widest + 2 * LABEL_MARGIN : 0, (passing.length + 1) * LANE + 2 * 8);
  });
  return { ranks, links, gaps };
}

// Wraps the ranks into bands and keeps the band count that fits the screen best, or the previous
// count while it stays within the slack. Each child sits across the flow at the average centre of
// its already placed neighbours, in `key` order where known.
function wrapRanks({ ranks, links, gaps }: Ranked, size: (id: string) => { main: number; cross: number }, key: Map<string, number>, horizontal: boolean, keep: number | undefined, isGroup: (id: string) => boolean, centred: boolean, was: Map<string, { centre: number; size: number }>, anchor: Anchor): Layout {
  const neighbours = new Map<string, string[]>();
  for (const { from, to } of links) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }
  const rankOf = new Map(ranks.flatMap((members, index) => members.map(id => [id, index] as const)));
  // A link that skips ranks gets an empty slot in each rank it passes, ordered and placed like a card in line
  // with its nearer end, so the arrow can run straight through instead of round the whole rank.
  const slots = new Map<string, { near: string; key?: number }>();
  const members = ranks.map(rank => [...rank]);
  links.forEach(({ from, to }, n) => {
    const a = rankOf.get(from)!, b = rankOf.get(to)!;
    for (let r = Math.min(a, b) + 1; r < Math.max(a, b); r++) {
      const kf = key.get(from), kt = key.get(to), id = `\u0000${n}:${r}`;
      slots.set(id, { near: a < b ? from : to, key: kf === undefined || kt === undefined ? undefined : kf + ((kt - kf) * (r - a)) / (b - a) });
      members[r].push(id);
    }
  });
  const sizeOf = (id: string) => (slots.has(id) ? { main: 0, cross: 0 } : size(id));
  const roomBefore = (id: string) => {
    const entering = links.filter(link => link.to === id && rankOf.get(link.from)! < rankOf.get(id)!);
    return Math.max(0, stackedLabels(entering, 'cross') / 2 + 2 * LABEL_MARGIN - CARD_GAP);
  };
  // The gap before the band starting at `boundary` fits the labels and lanes of links crossing it.
  const gapCache = new Map<number, number>();
  const bandGap = (boundary: number) => gapCache.get(boundary) ?? gapCache.set(boundary, gapBefore(boundary)).get(boundary)!;
  const gapBefore = (boundary: number) => {
    const crossing = links.filter(link => Math.min(rankOf.get(link.from)!, rankOf.get(link.to)!) < boundary && boundary <= Math.max(rankOf.get(link.from)!, rankOf.get(link.to)!));
    const widest = stackedLabels(crossing, 'cross');
    // Top to bottom, arrows leaving a band downwards run along the gap; a lane either side of the labels lets them pass.
    return Math.max(BAND_GAP, widest ? widest + 2 * LABEL_MARGIN + (horizontal ? 0 : 2 * LANE) : 0, (crossing.length + 1) * LANE + 2 * 8);
  };
  const layoutBands = (bands: number) => {
    const perBand = Math.ceil(ranks.length / bands);
    const at = new Map<string, Point>();
    let crossOffset = 0, mainMax = 0;
    const reversed: string[] = [];
    for (let first = 0; first < ranks.length; first += perBand) {
      const band = ranks.slice(first, first + perBand).flat();
      // `anchor`, when set, keeps previous places, resizing cards as it says.
      const placeBand = (anchor?: Anchor, squeeze = 1) => {
        const keep = anchor !== undefined;
        const centre = new Map<string, number>(), at = new Map<string, Point>();
        // Children placed before any neighbour, in placing order per rank; they move over their neighbours afterwards.
        const unanchored: string[][] = [];
        let mainAt = 0, crossMax = 0;
        const ideal = (id: string) => {
          const placed = (slots.has(id) ? [slots.get(id)!.near] : neighbours.get(id) ?? []).filter(other => centre.has(other)).map(other => centre.get(other)!);
          return placed.length ? placed.reduce((sum, value) => sum + value, 0) / placed.length : undefined;
        };
        // Kept, a card seen before wants its previous place across the flow, measured from the previous edge of these
        // cards; cards beside a resized card in its rank make room, or close up below.
        const seen = keep ? band.filter(id => was.has(id)) : [];
        const edge = Math.min(...seen.map(id => was.get(id)!.centre - was.get(id)!.size / 2));
        const resized = seen.map(id => ({ id, from: was.get(id)!.centre - was.get(id)!.size / 2 - edge, span: was.get(id)!.size, by: size(id).cross - was.get(id)!.size })).filter(card => card.by);
        const kept = new Map(seen.map(id => {
          const at = was.get(id)!.centre - edge;
          if (anchor !== 'stretch') return [id, at + (anchor! - 0.5) * -(size(id).cross - was.get(id)!.size)] as const;
          // Past a resized card a card moves by the whole change; level with it, in proportion. Undone exactly by the reverse change.
          return [id, resized.reduce((sum, card) => sum + card.by * Math.min(1, Math.max(0, (at - card.from) / card.span)), at)] as const;
        }));
        // The least gap each child needs after the one before it in its rank, which closing holes must leave.
        const needs: Need[] = [];
        for (let index = first; index < Math.min(first + perBand, ranks.length); index++) {
          const width = Math.max(...ranks[index].map(id => size(id).main));
          // A card seen before sorts by its previous near edge, so a lane through it goes past it, not before it.
          const sortKey = (id: string) => (keep && was.has(id) ? was.get(id)!.centre - was.get(id)!.size / 2 : key.get(id)) ?? slots.get(id)?.key ?? ideal(id) ?? Infinity;
          // Kept places may start before the band's edge; the whole band moves back afterwards.
          let next = keep ? -Infinity : 0, last: { id: string; end: number } | undefined;
          const keys = new Map(members[index].map(id => [id, sortKey(id)]));
          for (const id of [...members[index]].sort((a, b) => keys.get(a)! - keys.get(b)!)) {
            const { main, cross } = sizeOf(id);
            const want = kept.has(id) ? kept.get(id)! * squeeze : ideal(id);
            let start = Math.max(next, want === undefined ? Math.max(next, 0) : want - cross / 2);
            // Top to bottom, an arrow into a group from an earlier rank runs round the header and down the group's
            // side; a gap on the side facing its source keeps room for half its label, which sits centred on that arrow.
            const room = !horizontal && isGroup(id) ? roomBefore(id) : 0;
            // Kept places put that room on the near side, so a card at its kept place leaves the cards after it theirs.
            const before = want !== undefined && (keep || want < start + cross / 2);
            if (before && last) start = Math.max(start, next + room);
            if (last) needs.push({ before: last.id, after: id, gap: (before ? next + room : next) - last.end });
            last = { id, end: start + cross };
            centre.set(id, start + cross / 2);
            if (want === undefined && !slots.has(id)) (unanchored[index] ??= []).push(id);
            next = slots.has(id) ? start + LANE : start + cross + CARD_GAP + (before ? 0 : room);
            crossMax = Math.max(crossMax, start + cross);
            const along = mainAt + (width - main) / 2;
            at.set(id, horizontal ? { x: along, y: start } : { x: start, y: along });
          }
          mainAt += width + (index < first + perBand - 1 ? gaps[index] : 0);
        }
        // Kept places can leave stretches no child covers (where a group was, say); closing them keeps every child's
        // side of every other, so the band shrinks without losing the previous order.
        if (keep) {
          const crossAt = (id: string) => (horizontal ? at.get(id)!.y : at.get(id)!.x);
          const starts = closeHoles(new Map([...at.keys()].map(id => [id, { start: crossAt(id), end: crossAt(id) + sizeOf(id).cross }])), needs);
          crossMax = 0;
          for (const [id, start] of starts) {
            at.set(id, horizontal ? { ...at.get(id)!, y: start } : { ...at.get(id)!, x: start });
            centre.set(id, start + sizeOf(id).cross / 2);
            crossMax = Math.max(crossMax, start + sizeOf(id).cross);
          }
        }
        // A child placed before its neighbours (a hub over its fan-out, say) moves over the average centre of the
        // neighbours placed after it, as far as the cards beside it in its rank and the band's width allow.
        // Latest ranks first, so a chain of such children follows the one below it.
        const crossAt = (id: string) => (horizontal ? at.get(id)!.y : at.get(id)!.x);
        for (let index = centred ? unanchored.length - 1 : -1; index >= first; index--) {
          for (const id of unanchored[index] ?? []) {
            const want = ideal(id);
            if (want === undefined) continue;
            const row = members[index].filter(other => other !== id && !slots.has(other)).map(other => ({ lo: crossAt(other), hi: crossAt(other) + sizeOf(other).cross }));
            const cross = sizeOf(id).cross, now = crossAt(id);
            const lo = Math.max(0, ...row.filter(box => box.hi <= now).map(box => box.hi + CARD_GAP));
            const hi = Math.min(crossMax, ...row.filter(box => box.lo >= now + cross).map(box => box.lo - CARD_GAP)) - cross;
            const start = Math.min(Math.max(want - cross / 2, lo), Math.max(hi, lo));
            centre.set(id, start + cross / 2);
            at.set(id, horizontal ? { ...at.get(id)!, y: start } : { ...at.get(id)!, x: start });
          }
        }
        return { at, crossMax, mainAt };
      };
      // Previous places are kept only while the band stays near its compact width, so toggles cannot make it grow.
      // Past that, the kept places are squeezed towards the band's edge, which keeps cards on the same sides of each other.
      const compact = placeBand(), limit = compact.crossMax * KEEP_SLACK;
      let chosen = compact;
      if (band.some(id => was.has(id))) {
        for (let squeeze = 1, tries = 0; tries < SQUEEZES; tries++) {
          const attempt = placeBand(anchor, squeeze);
          if (attempt.crossMax <= limit) { chosen = attempt; break; }
          squeeze *= limit / attempt.crossMax;
        }
      }
      const { at: bandAt, crossMax, mainAt } = chosen;
      for (const [id, point] of bandAt) {
        at.set(id, horizontal ? { x: point.x, y: point.y + crossOffset } : { x: point.x + crossOffset, y: point.y });
        if ((first / perBand) % 2 === 1) reversed.push(id);
      }
      mainMax = Math.max(mainMax, mainAt);
      crossOffset += crossMax + (first + perBand < ranks.length ? bandGap(first + perBand) : 0);
    }
    // Odd bands run backwards, so the arrow into each band drops straight from the end of the last.
    for (const id of reversed) {
      const point = at.get(id)!;
      if (horizontal) point.x = mainMax - point.x - sizeOf(id).main;
      else point.y = mainMax - point.y - sizeOf(id).main;
    }
    const width = horizontal ? mainMax : crossOffset, height = horizontal ? crossOffset : mainMax;
    const bandOf = (id: string) => Math.floor(rankOf.get(id)! / perBand);
    const split = links.filter(link => bandOf(link.from) !== bandOf(link.to)).length;
    return { width, height, bands, at, score: screenFit(width, height) * (1 + CROSS_BAND_COST * split) };
  };
  if (!ranks.length) return { width: 0, height: 0, bands: 1, at: new Map() };
  // A band holds at least two ranks: a band of one rank turns every arrow back.
  // Band counts sharing a ranks-per-band share one layout.
  const byPerBand = new Map<number, ReturnType<typeof layoutBands>>();
  const options = ranks.map((_, index) => index + 1).filter(bands => bands === 1 || Math.ceil(ranks.length / bands) >= 2).map(bands => {
    const perBand = Math.ceil(ranks.length / bands);
    if (!byPerBand.has(perBand)) byPerBand.set(perBand, layoutBands(bands));
    return { ...byPerBand.get(perBand)!, bands };
  });
  const best = options.reduce((winner, option) => (option.score < winner.score ? option : winner));
  const kept = keep ? options[keep - 1] : undefined;
  return kept && kept.score <= best.score * KEEP_BANDS_SLACK ? kept : best;
}

// Where each span starts once the spans begin at 0 and every stretch no span covers shrinks to CARD_GAP, as far as
// the gaps in `needs` allow. Spans move only towards the start and never past one another.
function closeHoles(spans: Map<string, { start: number; end: number }>, needs: Need[]): Map<string, number> {
  const sorted = [...spans.values()].sort((a, b) => a.start - b.start);
  const slack = needs.map(need => spans.get(need.after)!.start - spans.get(need.before)!.end - need.gap);
  const holes: { at: number; by: number }[] = [];
  let reach = sorted[0].start;
  for (const span of sorted) {
    if (span.start - reach > CARD_GAP) {
      const across = needs.flatMap((need, index) => (spans.get(need.before)!.end <= reach && spans.get(need.after)!.start >= span.start ? [index] : []));
      const by = Math.max(0, Math.min(span.start - reach - CARD_GAP, ...across.map(index => slack[index])));
      for (const index of across) slack[index] -= by;
      holes.push({ at: span.start, by });
    }
    reach = Math.max(reach, span.end);
  }
  return new Map([...spans].map(([id, { start }]) => [id, start - sorted[0].start - holes.filter(hole => hole.at <= start).reduce((sum, hole) => sum + hole.by, 0)]));
}

/**
 * The share of node pairs, present in both layouts, whose left-right and above-below order is unchanged. Centres
 * within 40 px of each other on an axis count as level on it, as people see them.
 */
export function orderKept(before: Pick<Diagram, 'nodes'>, after: Pick<Diagram, 'nodes'>): number {
  const centre = (node: DiagramNode) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
  const was = new Map(before.nodes.map(node => [node.id, centre(node)]));
  const now = new Map(after.nodes.map(node => [node.id, centre(node)]));
  const ids = [...was.keys()].filter(id => now.has(id));
  const side = (a: Point, b: Point) => `${Math.sign(Math.round((b.x - a.x) / LEVEL))},${Math.sign(Math.round((b.y - a.y) / LEVEL))}`;
  let same = 0, pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs++;
      if (side(was.get(ids[i])!, was.get(ids[j])!) === side(now.get(ids[i])!, now.get(ids[j])!)) same++;
    }
  }
  return pairs ? same / pairs : 1;
}

// The deepest label stack in a gap: labels of links joining the same two children share one
// stretch of the gap, so they stack along `axis`; other labels sit side by side.
function stackedLabels(links: Link[], axis: 'main' | 'cross'): number {
  const stacks = new Map<string, number>();
  for (const link of links) {
    const pair = [link.from, link.to].sort().join(' ');
    stacks.set(pair, (stacks.get(pair) ?? 0) + link.label[axis]);
  }
  return Math.max(0, ...stacks.values());
}

// Area scaled by how far the aspect ratio strays from the target (diagrams are judged by how well they fit a screen).
function screenFit(width: number, height: number): number {
  const ratio = width / height || 1;
  return width * height * Math.max(ratio / TARGET_RATIO, TARGET_RATIO / ratio);
}

// For every node, the mean cross-axis centre of its arrows' far ends outside its own subtree:
// arrows in, arrows out, or both. A node with no such arrow keeps its current centre.
function barycentres(nodes: DiagramNode[], edges: Diagram['edges'], chains: Map<string, string[]>, horizontal: boolean, pull?: 'in' | 'out'): Map<string, number> {
  const centre = new Map(nodes.map(node => [node.id, horizontal ? node.y + node.height / 2 : node.x + node.width / 2]));
  const pulls = new Map<string, number[]>();
  for (const { source, target } of edges) {
    for (const [near, far] of pull === 'in' ? [[target, source]] : pull === 'out' ? [[source, target]] : [[source, target], [target, source]]) {
      const farChain = chains.get(far)!;
      for (const id of chains.get(near)!) {
        if (id === '' || farChain.includes(id)) break;
        pulls.set(id, [...(pulls.get(id) ?? []), centre.get(far)!]);
      }
    }
  }
  return new Map(nodes.map(node => {
    const values = pulls.get(node.id);
    return [node.id, values ? values.reduce((sum, value) => sum + value, 0) / values.length : centre.get(node.id)!];
  }));
}

// Crossings between straight centre-to-centre arrows: a cheap stand-in for routed crossings.
function straightCrossings(nodes: DiagramNode[], edges: Diagram['edges']): number {
  const centre = new Map(nodes.map(node => [node.id, { x: node.x + node.width / 2, y: node.y + node.height / 2 }]));
  const lines = edges.map(edge => ({ ends: [edge.source, edge.target], a: centre.get(edge.source)!, b: centre.get(edge.target)! }));
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  let crossings = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const first = lines[i], second = lines[j];
      if (first.ends.some(end => second.ends.includes(end))) continue;
      if (side(first.a, first.b, second.a) * side(first.a, first.b, second.b) < 0 && side(second.a, second.b, first.a) * side(second.a, second.b, first.b) < 0) crossings++;
    }
  }
  return crossings;
}

function topologicalOrder(ids: string[], out: Map<string, string[]>): string[] {
  const indegree = new Map(ids.map(id => [id, 0]));
  for (const targets of out.values()) for (const target of targets) indegree.set(target, indegree.get(target)! + 1);
  const queue = ids.filter(id => indegree.get(id) === 0), order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const target of out.get(id)!) {
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return order;
}

