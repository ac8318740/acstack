import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref, type RefObject } from 'react';
import {
  Background, BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps,
  Handle, MarkerType, type Node, type NodeProps, Panel, Position, ReactFlow, useInternalNode, useReactFlow,
} from '@xyflow/react';
import { ChevronDown, ListTodo, MessageSquarePlus, Minus, Plus } from 'lucide-react';
import { useQuestionCounts } from './design-questions.js';
import { ElementMetadata } from './element-metadata.js';
import { CARD_WIDTH, commentsOn, LABEL_WIDTH, revealViewport, type Diagram as DiagramModel, type DiagramEdge, type DiagramNode, type HeaderMeasurer, type MeasuredGeometry } from './alignment-graph.js';
import type { DiagramOrientation } from '../lib/alignment-packs.js';
import { pack } from './pack.js';

export type Zoom = 'business' | 'technical';
export type ViewportAnchor = { key: string; before: DiagramModel; node: Pick<DiagramNode, 'id' | 'x' | 'y'> };
type Actions = { onToggle: (groupId: string) => void; onSelect: (id: string) => void; onAnnotate: (id: string) => void; onQuestions: (id: string) => void };
type BoxData = DiagramNode & Actions & { zoom: Zoom; dimmed: boolean; comments: number; questions: number; orientation?: DiagramOrientation };
type RouteData = DiagramEdge & Actions & { state: 'idle' | 'active' | 'dimmed'; selectId: string; comments: number; questions: number; selected: boolean };
const ACCENT = 'oklch(42% 0.14 262)';
const EDGE = 'oklch(55% 0.035 262)';
const itemsText = (count = 0) => `${count} item${count === 1 ? '' : 's'}`;
const commentsText = (count: number) => `${count} comment${count === 1 ? '' : 's'}`;
const noActions: Actions = { onToggle: () => {}, onSelect: () => {}, onAnnotate: () => {}, onQuestions: () => {} };

function sourceFile(nodeId: string): string | undefined {
  const refs = pack.graph.nodes.find(node => node.id === nodeId)?.sourceRefs ?? [];
  return pack.source.references.filter(ref => refs.includes(ref.id)).map(ref => ref.uri).join(' · ');
}
function AnnotateButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <div className="annotation-actions nodrag nopan" role="group" aria-label={label.replace('Comment on ', 'Actions for ')}>
    <button type="button" className="annotate nodrag nopan" data-tooltip={label} aria-label={label} onClick={event => { event.stopPropagation(); onClick(); }}><MessageSquarePlus size={16} strokeWidth={2} /></button>
  </div>;
}

function QuestionBadge({ count, onClick }: { count: number; onClick: () => void }) {
  return count > 0 ? <button type="button" className="question-badge nodrag nopan" aria-label={`${count} design question${count === 1 ? ' needs' : 's need'} input`} data-tooltip={`${count} question${count === 1 ? ' needs' : 's need'} input`} onClick={event => { event.stopPropagation(); onClick(); }}><ListTodo size={14} aria-hidden="true" /><span>{count}</span></button> : null;
}

// Both the live canvas and the inert measuring tree use this exact content and constrained width.
function BoxContent({ data }: { data: BoxData }) {
  const framed = data.kind === 'group';
  const folded = data.kind === 'folded-group';
  const ref = data.ownerNodeId ?? data.refId;
  const technical = data.zoom === 'technical';
  const meta = technical ? [ref, sourceFile(ref)].filter(Boolean).join(' · ') : undefined;
  return <div className={`${framed ? 'group-content' : 'card-content'}${data.questions ? ' has-questions' : ''}`}>
    <div className="box-text nodrag nopan" data-annotate-type={data.ownerNodeId || !framed && !folded ? 'node' : 'group'} data-annotate-id={ref}>
      <div className="box-heading">
        {framed ? <button type="button" className="header-select" onClick={() => data.onSelect(data.id)}>{data.label}</button>
          : <div className="box-title">{technical ? data.technicalLabel ?? data.label : data.label}</div>}
        {(data.elementKind || data.channels?.length) && <ElementMetadata kind={data.elementKind} channels={data.channels} />}
      </div>
      <div className="box-sub">{data.summary}</div>
      {meta && <div className="box-meta">{meta}</div>}
    </div>
    <QuestionBadge count={data.questions} onClick={() => data.onQuestions(data.id)} />
    <AnnotateButton label={`Comment on ${data.label}`} onClick={() => data.onAnnotate(data.id)} />
    {(folded || framed || data.comments > 0) && <div className="card-controls">
      {(folded || framed) && <button type="button" className="link nodrag nopan" data-group-toggle={data.refId} aria-expanded={framed} onClick={event => { event.stopPropagation(); data.onToggle(data.refId); }}>
        {framed && <ChevronDown size={14} />} {framed ? 'Collapse' : 'Expand'}
      </button>}
      {(folded || framed) && <span className="box-kind">{itemsText(data.itemCount)}</span>}
      {data.comments > 0 && <span className="count-pill">{commentsText(data.comments)}</span>}
    </div>}
  </div>;
}
function ItemBox({ data, selected }: NodeProps<Node<BoxData>>) {
  return <div className={`box${data.kind === 'folded-group' ? ' folded' : ''}${selected ? ' selected' : ''}${data.dimmed ? ' dimmed' : ''}`} onClick={() => !window.getSelection()?.toString() && data.onSelect(data.id)}>
    <Handle type="target" position={data.orientation === 'left-to-right' ? Position.Left : Position.Top} /><BoxContent data={data} /><Handle type="source" position={data.orientation === 'left-to-right' ? Position.Right : Position.Bottom} />
  </div>;
}
function GroupFrame({ data, selected }: NodeProps<Node<BoxData>>) {
  return <div className={`frame${selected ? ' selected' : ''}`}><Handle type="target" position={data.orientation === 'left-to-right' ? Position.Left : Position.Top} /><BoxContent data={data} /><Handle type="source" position={data.orientation === 'left-to-right' ? Position.Right : Position.Bottom} /></div>;
}
function LabelContent({ edge, actions = noActions, comments = 0, questions = 0 }: { edge: DiagramEdge; actions?: Actions; comments?: number; questions?: number }) {
  const selectId = `edge:${edge.childEdgeIds[0]}`;
  return <div className={`label-content${questions ? ' has-questions' : ''}`} tabIndex={0} role="group" aria-label={`Relationship: ${edge.label}`} style={{ width: LABEL_WIDTH }}>
    <div className="edge-text nodrag nopan" onClick={() => !window.getSelection()?.toString() && actions.onSelect(selectId)} data-annotate-type="edge" data-annotate-id={edge.childEdgeIds[0]}>{edge.label}</div>
    <AnnotateButton label={`Comment on ${edge.label}`} onClick={() => actions.onAnnotate(selectId)} />
    <QuestionBadge count={questions} onClick={() => actions.onQuestions(selectId)} />
    {comments > 0 && <span className="count-pill">{comments}</span>}
  </div>;
}
export type MeasureDiagramHandle = { measureHeaders: HeaderMeasurer };

export function MeasureDiagram({ diagram, zoom, onMeasured, commentCounts, ref }: { diagram: DiagramModel; zoom: Zoom; onMeasured: (geometry: MeasuredGeometry) => void; commentCounts?: Map<string, number>; ref?: Ref<MeasureDiagramHandle> }) {
  const questionCounts = useQuestionCounts(diagram);
  const tree = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    measureHeaders: nodes => {
      const headers: ReturnType<HeaderMeasurer> = {};
      if (!tree.current) return headers;
      const elements = new Map([...tree.current.querySelectorAll<HTMLElement>('[data-measure="node"]')].map(element => [element.dataset.key, element]));
      const frames = nodes.flatMap(node => {
        const element = elements.get(node.id);
        return element ? [{ node, element, style: element.getAttribute('style'), className: element.className }] : [];
      });
      try {
        // Batch writes before reading geometry; match the live border and floating control origin.
        for (const { node, element } of frames) {
          element.className = node.kind === 'group' ? 'frame' : 'box';
          element.style.width = `${node.width}px`;
          element.style.height = `${node.height}px`;
        }
        for (const { node, element } of frames) {
          try {
            const origin = element.getBoundingClientRect();
            // Browser subpixel rounding must not turn the requested frame width into stale input.
            if (origin.height <= 0 || Math.abs(origin.width - node.width) >= 0.5) continue;
            const local = (rect: DOMRect) => ({ x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height });
            if (node.kind !== 'group') {
              const hardObstacles = [...element.querySelectorAll('.annotation-actions button, .question-badge')].map(control => local(control.getBoundingClientRect()));
              if (hardObstacles.length && hardObstacles.every(box => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0)) headers[node.id] = { width: node.width, hardObstacles, subtitleLines: [] };
              continue;
            }
            if (!element.querySelector('.group-content') || !element.querySelector('.box-sub')) continue;
            const textRects = (selector: string) => [...element.querySelectorAll(selector)].flatMap(content => {
              const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
              const boxes = [];
              for (let text = walker.nextNode(); text; text = walker.nextNode()) {
                if (!text.textContent?.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(text);
                boxes.push(...[...range.getClientRects()].map(local));
              }
              return boxes;
            });
            const titles = textRects('.header-select');
            const hardObstacles = [
              ...titles,
              ...textRects('.box-meta, .box-kind'),
              ...[...element.querySelectorAll('.type-pill, .channel-pill, .card-controls button, .count-pill, .annotation-actions button, .question-badge')].map(control => local(control.getBoundingClientRect())),
            ];
            const subtitleLines = textRects('.box-sub');
            if (!titles.length || [...hardObstacles, ...subtitleLines].some(box => !Object.values(box).every(Number.isFinite) || box.width <= 0 || box.height <= 0)) continue;
            headers[node.id] = { width: node.width, hardObstacles, subtitleLines };
          } catch {
            // Missing DOM geometry keeps this header conservatively blocked.
          }
        }
      } finally {
        for (const { element, style, className } of frames) {
          element.className = className;
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
        }
      }
      return headers;
    },
  }), [diagram, zoom, commentCounts, questionCounts]);
  useLayoutEffect(() => {
    let current = true;
    void document.fonts.ready.then(() => {
      if (!current || !tree.current) return;
      const geometry: MeasuredGeometry = { nodes: {}, labels: {} };
      for (const element of tree.current.querySelectorAll<HTMLElement>('[data-measure]')) {
        const bucket = element.dataset.measure === 'node' ? geometry.nodes : geometry.labels;
        bucket[element.dataset.key!] = { width: Math.ceil(element.offsetWidth), height: Math.ceil(element.offsetHeight) };
      }
      onMeasured(geometry);
    });
    return () => { current = false; };
  }, [diagram, zoom, onMeasured, commentCounts, questionCounts]);
  return <div ref={tree} className="measurement" aria-hidden="true" inert>
    {diagram.nodes.map(node => <div key={node.id} data-measure="node" data-key={node.id} className={node.kind === 'group' ? 'measure-header' : 'box'} style={{ width: CARD_WIDTH }}><BoxContent data={{ ...node, ...noActions, zoom, dimmed: false, questions: questionCounts.get(node.id) ?? 0, comments: commentsOn(node, commentCounts, diagram, pack.graph) }} /></div>)}
    {diagram.edges.map(edge => <div key={edge.id} data-measure="label" data-key={edge.id} className="edge-label" style={{ width: LABEL_WIDTH }}><LabelContent edge={edge} questions={questionCounts.get(`edge:${edge.childEdgeIds[0]}`) ?? 0} comments={edge.childEdgeIds.reduce((sum, id) => sum + (commentCounts?.get(`edge:${id}`) ?? 0), 0)} /></div>)}
  </div>;
}
function RoutedEdge({ id, data, markerEnd, markerStart }: EdgeProps<Edge<RouteData>>) {
  if (!data) return null;
  const box = data.labelBox;
  return <>
    <BaseEdge id={id} path={data.path} className={data.state} interactionWidth={16} />
    <path d={data.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} fill="none" stroke="none" strokeWidth={data.state === 'active' ? 2 : 1.5} opacity={data.state === 'dimmed' ? 0.2 : 1} markerStart={markerStart} markerEnd={markerEnd} pointerEvents="none" />
    {box && <EdgeLabelRenderer><div className={`edge-label ${data.state}`} data-selected={data.selected} data-tooltip={data.summary} style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height }}><LabelContent edge={data} actions={data} comments={data.comments} questions={data.questions} /></div></EdgeLabelRenderer>}
  </>;
}
const nodeTypes = { item: ItemBox, 'folded-group': ItemBox, group: GroupFrame };
const edgeTypes = { routed: RoutedEdge };
const expansionKey = (ids: string[]) => [...ids].sort().join('|');
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type ToggleFocus = { groupId: string; key: string; before: DiagramModel; origin: HTMLElement };

// Keep readiness updates out of Diagram so they do not recreate ReactFlow's node inputs.
function RestoreToggleFocus({ diagram, layoutKey, requestedKey, expanded, pending, canvas }: {
  diagram: DiagramModel; layoutKey: string; requestedKey: string; expanded: string[];
  pending: RefObject<ToggleFocus | null>; canvas: RefObject<HTMLDivElement | null>;
}) {
  const target = useInternalNode(pending.current ? `group:${pending.current.groupId}` : '');
  const { getNodes } = useReactFlow();
  useEffect(() => {
    const cancel = (event: FocusEvent) => {
      const focus = pending.current;
      if (focus && event.target !== document.body && event.target !== focus.origin && !(event.target instanceof HTMLElement && canvas.current?.contains(event.target) && event.target.dataset.groupToggle === focus.groupId)) pending.current = null;
    };
    document.addEventListener('focusin', cancel);
    return () => document.removeEventListener('focusin', cancel);
  }, [pending, canvas]);
  useEffect(() => {
    const focus = pending.current;
    if (!focus) return;
    if (focus.key !== requestedKey) { pending.current = null; return; }
    if (focus.key !== layoutKey || diagram === focus.before || !target?.internals.handleBounds) return;
    // The target subscription retries when ReactFlow adopts and measures the replacement.
    const live = getNodes();
    if (live.length !== diagram.nodes.length || diagram.nodes.some(node => !live.some(current => current.id === node.id && current.type === node.kind && current.data.x === node.x && current.data.y === node.y))) return;
    const active = document.activeElement;
    if (active !== document.body && active !== focus.origin && !(active instanceof HTMLElement && canvas.current?.contains(active) && active.dataset.groupToggle === focus.groupId)) { pending.current = null; return; }
    const button = [...canvas.current?.querySelectorAll<HTMLElement>('[data-group-toggle]') ?? []].find(button => button.dataset.groupToggle === focus.groupId);
    if (button?.getAttribute('aria-expanded') !== String(expanded.includes(focus.groupId))) return;
    button.focus({ preventScroll: true });
    // Keep the request through the replacement commit; consume only sustained focus.
    const frame = requestAnimationFrame(() => {
      if (pending.current === focus && button.isConnected && document.activeElement === button) pending.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [diagram, layoutKey, target, requestedKey, expanded, getNodes, pending, canvas]);
  return null;
}

export function Diagram({ diagram, expanded, setExpanded, zoom, setZoom, selected, onSelect, onAnnotate, onQuestions = () => {}, commentCounts, layoutKey = '', anchor, contentZoom = zoom, orientation = 'top-to-bottom', reveal }: {
  /** A card to bring into view once the layout holds it, such as an approval blocker's element. */
  reveal?: { id: string };
  diagram: DiagramModel; expanded: string[]; setExpanded: (ids: string[], anchorId?: string) => void; zoom: Zoom; setZoom: (zoom: Zoom) => void; anchor?: ViewportAnchor | null;
  selected: string | null; onSelect: (id: string | null) => void; onAnnotate: (id: string) => void; onQuestions?: (id: string | null) => void; commentCounts: Map<string, number>; layoutKey?: string; contentZoom?: Zoom; orientation?: DiagramOrientation;
}) {
  const questionCounts = useQuestionCounts(diagram);
  const { fitView, zoomIn, zoomOut, getViewport, setViewport } = useReactFlow();
  const revealed = useRef<{ id: string } | undefined>(undefined);
  const revealedIn = useRef<DiagramModel | undefined>(undefined);
  const fitted = useRef(false);
  const appliedAnchor = useRef<ViewportAnchor | null>(null);
  const pending = useRef<ToggleFocus | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reveal || revealed.current === reveal) return;
    const node = diagram.nodes.find(item => item.id === reveal.id);
    if (!node) return;
    revealed.current = reveal;
    revealedIn.current = diagram;
    const { top, bottom, x } = fitPadding();
    const area = { x, y: top, width: (canvas.current?.clientWidth ?? 0) - 2 * x, height: (canvas.current?.clientHeight ?? 0) - top - bottom };
    const view = revealViewport(node, diagram.nodes, area);
    if (view === 'fit') fit(true, true);
    else void setViewport(view, { duration: reducedMotion() ? 0 : 200 });
  }, [reveal, diagram, setViewport]);
  // The view keeps clear of the toolbar above and the zoom controls below.
  const fitPadding = () => ({ top: (canvas.current?.querySelector<HTMLElement>('.toolbar')?.offsetHeight ?? 0) + 30, bottom: 80, x: 30 });
  // Refitting on resize stops once the reviewer pans or zooms; Fit diagram hands control back.
  const userMoved = useRef(false);
  const fit = (animate = true, keepFocus = false) => {
    if (!keepFocus) pending.current = null;
    userMoved.current = false;
    const { top, bottom, x } = fitPadding();
    void fitView({ padding: { top: `${top}px`, bottom: `${bottom}px`, x: `${x}px` }, minZoom: 0.15, maxZoom: 1.25, duration: animate && !reducedMotion() ? 200 : 0 });
  };
  // The canvas narrows when the drawer opens and with the window, so the fitted view follows it.
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let size = '';
    const observer = new ResizeObserver(([entry]) => {
      const next = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
      if (next === size) return;
      const first = !size;
      size = next;
      if (!first && fitted.current && !userMoved.current) fit(false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitView]);
  useEffect(() => {
    if (!diagram.nodes.length || fitted.current) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      fitted.current = true;
      fit();
    }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [diagram, fitView]);
  // Expanding or collapsing changes the layout, so the view refits unless the reviewer has moved it.
  const laidOut = useRef(diagram);
  useEffect(() => {
    if (laidOut.current === diagram) return;
    laidOut.current = diagram;
    // A revealed element keeps its centring for the layout that brought it into view.
    if (fitted.current && !userMoved.current && revealedIn.current !== diagram) fit(true, true);
  }, [diagram, fitView]);
  useLayoutEffect(() => {
    if (!anchor || anchor === appliedAnchor.current || anchor.key !== layoutKey || diagram === anchor.before) return;
    const node = diagram.nodes.find(node => node.id === anchor.node.id);
    if (!node) return;
    const viewport = getViewport();
    // Keep the clicked component on screen without constraining its world position or changing zoom.
    void setViewport({ ...viewport, x: viewport.x + (anchor.node.x - node.x) * viewport.zoom, y: viewport.y + (anchor.node.y - node.y) * viewport.zoom }, { duration: 0 });
    appliedAnchor.current = anchor;
  }, [anchor, diagram, layoutKey, getViewport, setViewport]);
  const toggle = (groupId: string) => {
    const next = expanded.includes(groupId) ? expanded.filter(id => id !== groupId) : [...expanded, groupId];
    pending.current = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement.dataset.groupToggle === groupId ? { groupId, key: `${expansionKey(next)}:${zoom}`, before: diagram, origin: document.activeElement } : null;
    setExpanded(next, `group:${groupId}`);
  };
  const selectedEdge = selected?.startsWith('edge:') ? diagram.edges.find(edge => edge.childEdgeIds.includes(selected.slice(5))) : undefined;
  const linked = new Set<string>(selectedEdge ? [selectedEdge.source, selectedEdge.target] : selected ? [selected] : []);
  for (const edge of diagram.edges) { if (edge.source === selected) linked.add(edge.target); if (edge.target === selected) linked.add(edge.source); }
  const actions: Actions = { onToggle: toggle, onSelect, onAnnotate, onQuestions };
  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const nodes: Node<BoxData>[] = diagram.nodes.map(node => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const comments = commentsOn(node, commentCounts, diagram, pack.graph);
    let depth = 0;
    for (let ancestor = parent; ancestor; ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined) depth++;
    // ReactFlow puts children above their parents; keep every frame below routes at z-index 0.
    const zIndex = node.kind === 'group' ? depth - diagram.nodes.length : 1;
    return { id: node.id, type: node.kind, parentId: node.parentId, position: { x: node.x - (parent?.x ?? 0), y: node.y - (parent?.y ?? 0) }, initialWidth: node.width, initialHeight: node.height,
      // Every render passes new node objects; without `measured`, ReactFlow drops each node's handle bounds and hides its edges until that node happens to resize.
      measured: { width: node.width, height: node.height }, style: { width: node.width, height: node.height }, selectable: true, draggable: false, selected: node.id === selected, zIndex, data: { ...node, ...actions, orientation, zoom: contentZoom, dimmed: Boolean(selected) && !linked.has(node.id), comments, questions: questionCounts.get(node.id) ?? 0 } };
  });
  const edges: Edge<RouteData>[] = diagram.edges.map(edge => {
    const state = !selected ? 'idle' : edge === selectedEdge || edge.source === selected || edge.target === selected ? 'active' : 'dimmed';
    const comments = edge.childEdgeIds.reduce((sum, id) => sum + (commentCounts.get(`edge:${id}`) ?? 0), 0);
    const name = (id: string) => byId.get(id)?.label ?? id;
    return { id: edge.id, source: edge.source, target: edge.target, type: 'routed', ariaLabel: `${name(edge.source)} ${edge.label} ${name(edge.target)} (${edge.bidirectional ? 'both directions' : 'source to target'})`, data: { ...edge, ...actions, state, selectId: `edge:${edge.childEdgeIds[0]}`, comments, questions: questionCounts.get(`edge:${edge.childEdgeIds[0]}`) ?? 0, selected: edge === selectedEdge }, markerStart: edge.bidirectional ? { type: MarkerType.ArrowClosed, width: 14, height: 14, color: state === 'active' ? ACCENT : EDGE } : undefined, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: state === 'active' ? ACCENT : EDGE }, zIndex: state === 'active' ? 2 : 0 };
  });
  return <div ref={canvas} className="diagram-canvas"><ReactFlow onMoveStart={event => { if (event) userMoved.current = true; }} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode="light" zIndexMode="manual" elevateNodesOnSelect={false} nodesConnectable={false} minZoom={0.15} maxZoom={2} panOnScroll={true} zoomOnScroll={false} zoomOnPinch={true} panOnDrag={true}
    onNodeClick={(_, node) => onSelect(node.id)} onEdgeClick={(_, edge) => edge.data && onSelect(edge.data.selectId)}
    onKeyDown={event => {
      if (event.key.toLowerCase() === 'f' && event.target instanceof Element && !event.target.closest('input,textarea,button')) { event.preventDefault(); fit(); return; }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target;
      if (!(target instanceof Element) || !target.matches('.react-flow__node, .react-flow__edge')) return;
      const id = target.getAttribute('data-id');
      const selectId = nodes.find(node => node.id === id)?.id ?? edges.find(edge => edge.id === id)?.data?.selectId;
      if (selectId) { event.preventDefault(); onSelect(selectId); }
    }} onPaneClick={() => onSelect(null)} proOptions={{ hideAttribution: true }}>
    <RestoreToggleFocus diagram={diagram} layoutKey={layoutKey} requestedKey={`${expansionKey(expanded)}:${zoom}`} expanded={expanded} pending={pending} canvas={canvas} />
    <Background gap={20} size={1.2} />
    <Panel position="top-left" className="toolbar">
      {pack.documentKind === 'design' ? <label className="metadata-toggle"><input type="checkbox" checked={zoom === 'technical'} onChange={event => { pending.current = null; setZoom(event.target.checked ? 'technical' : 'business'); }} /> Show source metadata</label>
        : <div className="segmented" role="radiogroup" aria-label="Detail level">{(['business', 'technical'] as const).map(value => <label key={value}><input type="radio" name="detail-level" checked={zoom === value} onChange={() => setZoom(value)} />{value === 'business' ? 'Business' : 'Technical'}</label>)}</div>}
      <div className="segmented"><button type="button" onClick={() => { pending.current = null; setExpanded(pack.graph.groups.map(group => group.id)); }}>Expand all</button><button type="button" onClick={() => { pending.current = null; setExpanded(pack.documentKind === 'design' ? ['design:root'] : []); }}>Collapse all</button></div>
    </Panel>
    {pack.designDocument?.questions?.length ? <Panel position="bottom-right" className="question-legend"><button type="button" className="btn" onClick={() => onQuestions(null)}><ListTodo size={14} aria-hidden="true" /> Design questions</button></Panel> : null}
    <Panel position="bottom-left" className="zoom-controls"><div role="group" aria-label="Diagram viewport"><button type="button" className="icon-btn" aria-label="Zoom out" data-tooltip="Zoom out" onClick={() => { userMoved.current = true; void zoomOut(); }}><Minus size={18} /></button><button type="button" className="icon-btn" aria-label="Zoom in" data-tooltip="Zoom in" onClick={() => { userMoved.current = true; void zoomIn(); }}><Plus size={18} /></button><button type="button" className="btn" onClick={() => fit()} data-tooltip="Fit the complete diagram (F)">Fit diagram</button></div></Panel>
  </ReactFlow></div>;
}
