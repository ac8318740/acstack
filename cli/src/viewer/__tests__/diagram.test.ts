import { afterEach, expect, it, vi } from 'vitest';
import { createElement, type KeyboardEvent, type KeyboardEventHandler, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Diagram, MeasureDiagram } from '../diagram.js';
import { Position, ReactFlowProvider, type ReactFlowProps } from '@xyflow/react';
import { adoptUserNodes, updateAbsolutePositions } from '@xyflow/system';

let keyDown: KeyboardEventHandler<HTMLDivElement> | undefined;
let edgeNames: (string | undefined)[] = [];
let flowProps: ReactFlowProps;
let toggleGroup: ((groupId: string) => void) | undefined;
const { mockPack } = vi.hoisted(() => ({ mockPack: {
  documentKind: undefined as 'design' | undefined,
  graph: { groups: [], nodes: [{ id: 'app', sourceRefs: ['source-app'] }] },
  source: { references: [{ id: 'source-app', uri: 'elements/app.yaml' }] },
} }));
vi.mock('@xyflow/react', async importOriginal => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  useReactFlow: () => ({ fitView: vi.fn() }),
  useInternalNode: () => undefined, // SSR has no mounted nodes or DOM measurements.
  Controls: () => null, Background: () => null,
  Handle: (props: { type: string; position: string }) => createElement('span', { 'data-handle': props.type, 'data-position': props.position }),
  Panel: (props: { children?: ReactNode }) => props.children,
  ReactFlow: (props: ReactFlowProps) => {
    flowProps = props;
    toggleGroup = props.nodes?.[0]?.data.onToggle as typeof toggleGroup;
    keyDown = props.onKeyDown;
    edgeNames = props.edges?.map(edge => edge.ariaLabel) ?? [];
    return createElement('div', {}, props.children);
  },
}));
vi.mock('../pack.js', () => ({ pack: mockPack }));
afterEach(() => { vi.unstubAllGlobals(); mockPack.documentKind = undefined; });

it.each([{ expanded: [] }, { expanded: ['app-group'] }])('requests a model anchor for group toggles from $expanded', ({ expanded }) => {
  const setExpanded = vi.fn();
  const html = renderToStaticMarkup(createElement(Diagram, {
    diagram: { nodeToVisible: {}, nodes: [{ id: 'group:app-group', kind: expanded.length ? 'group' : 'folded-group', refId: 'app-group', label: 'App', summary: 'Runs commands', x: -100, y: 250, width: 300, height: 120 }], edges: [] },
    expanded, setExpanded, zoom: 'business', setZoom: vi.fn(),
    selected: null, onSelect: vi.fn(), onAnnotate: vi.fn(), commentCounts: new Map(),
  }));
  expect(html).toContain('aria-label="Zoom in"');
  expect(html).toContain('aria-label="Zoom out"');
  expect(html).toContain('aria-label="Diagram viewport"');
  expect(html).toContain('Fit diagram');
  expect(html).not.toContain(' title=');
  toggleGroup!('app-group');
  expect(setExpanded).toHaveBeenCalledExactlyOnceWith(expanded.length ? [] : ['app-group'], 'group:app-group');
  expect(flowProps).toMatchObject({ panOnScroll: true, zoomOnScroll: false, zoomOnPinch: true, panOnDrag: true });
});
it('keeps selected frames below routes and cards without disabling selection', () => {
  renderToStaticMarkup(createElement(Diagram, {
    diagram: { nodeToVisible: {}, nodes: [
      { id: 'group:root', kind: 'group', refId: 'root', label: 'Root', summary: 'Owns the app', x: 0, y: 0, width: 800, height: 700 },
      { id: 'group:app', kind: 'group', parentId: 'group:root', refId: 'app', label: 'App', summary: 'Runs commands', x: 60, y: 160, width: 600, height: 400 },
    ], edges: [] },
    expanded: ['app'], setExpanded: vi.fn(), zoom: 'business', setZoom: vi.fn(),
    selected: 'group:app', onSelect: vi.fn(), onAnnotate: vi.fn(), commentCounts: new Map(),
  }));
  expect(flowProps.elevateNodesOnSelect).toBe(false);
  expect(flowProps.nodes?.[1]).toMatchObject({ selected: true, selectable: true });
  expect(flowProps.nodes?.[1].zIndex).toBeLessThan(0);
  const nodes: Parameters<typeof adoptUserNodes>[1] = new Map();
  const parents: Parameters<typeof adoptUserNodes>[2] = new Map();
  const options = { elevateNodesOnSelect: flowProps.elevateNodesOnSelect, zIndexMode: flowProps.zIndexMode };
  adoptUserNodes(flowProps.nodes ?? [], nodes, parents, options);
  // ReactFlow's measurement path omits elevateNodesOnSelect; manual layering must still hold.
  updateAbsolutePositions(nodes, parents, { zIndexMode: flowProps.zIndexMode });
  expect(nodes.get('group:app')?.internals.z).toBe(flowProps.nodes?.[1].zIndex);
  expect(nodes.get('group:root')?.internals.z).toBeLessThan(nodes.get('group:app')!.internals.z);
});
it('measures full folded responsibilities, source metadata, and native controls without duplicate handles', () => {
  const diagram = { nodeToVisible: { app: 'group:app-group' }, nodes: [{ id: 'group:app-group', refId: 'app-group', ownerNodeId: 'app', kind: 'folded-group' as const, label: 'App', summary: 'The full responsibility remains available on folded cards.', itemCount: 3, x: 0, y: 0, width: 300, height: 200 }], edges: [] };
  const html = renderToStaticMarkup(createElement(MeasureDiagram, { diagram, zoom: 'technical', onMeasured: vi.fn() }));
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('inert=""');
  expect(html).toContain('The full responsibility remains available on folded cards.');
  expect(html).toContain('3 items');
  expect(html).toContain('elements/app.yaml');
  expect(html).toContain('data-group-toggle="app-group"');
  expect(html).not.toContain('react-flow__handle');
});

it('distinguishes the selected relationship from links highlighted by a selected node', () => {
  const props = {
    diagram: { nodeToVisible: { app: 'item:app', data: 'item:data' }, nodes: [
      { id: 'item:app', kind: 'item' as const, refId: 'app', label: 'App', summary: '', x: 0, y: 0, width: 300, height: 100 },
      { id: 'item:data', kind: 'item' as const, refId: 'data', label: 'Data', summary: '', x: 400, y: 0, width: 300, height: 100 },
    ], edges: [{ id: 'route', source: 'item:app', target: 'item:data', childEdgeIds: ['reads'], label: 'Reads', points: [], path: '' }] },
    expanded: [], setExpanded: vi.fn(), zoom: 'business' as const, setZoom: vi.fn(), onSelect: vi.fn(), onAnnotate: vi.fn(), commentCounts: new Map(),
  };
  renderToStaticMarkup(createElement(Diagram, { ...props, selected: 'edge:reads' }));
  expect(flowProps.edges?.[0].data).toMatchObject({ state: 'active', selected: true });
  renderToStaticMarkup(createElement(Diagram, { ...props, selected: 'item:app' }));
  expect(flowProps.edges?.[0].data).toMatchObject({ state: 'active', selected: false });
  renderToStaticMarkup(createElement(Diagram, { ...props, selected: null }));
  expect(flowProps.edges?.[0].data).toMatchObject({ state: 'idle', selected: false });
});

it('renders endpoint arrows only at the real ends of a route with text gaps', () => {
  const path = 'M 0 0 L 40 0 M 60 0 L 120 0 M 160 0 L 200 0';
  renderToStaticMarkup(createElement(Diagram, {
    diagram: { nodeToVisible: {}, nodes: [], edges: [{
      id: 'route', source: 'item:app', target: 'item:data', childEdgeIds: ['reads'], label: 'Reads',
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], path, bidirectional: true,
    }] },
    expanded: [], setExpanded: vi.fn(), zoom: 'business', setZoom: vi.fn(),
    selected: null, onSelect: vi.fn(), onAnnotate: vi.fn(), commentCounts: new Map(),
  }));
  const html = renderToStaticMarkup(createElement(ReactFlowProvider, null,
    createElement('svg', null, createElement(flowProps.edgeTypes!.routed, {
      ...flowProps.edges![0], type: 'routed', data: flowProps.edges![0].data!,
      sourceX: 0, sourceY: 0, targetX: 200, targetY: 0,
      sourcePosition: Position.Right, targetPosition: Position.Left,
      markerStart: 'url(#start)', markerEnd: 'url(#end)',
    })),
  ));
  const paths = [...html.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
    tag, d: /\bd="([^"]*)"/.exec(tag)?.[1] ?? '',
  }));
  const gapped = paths.filter(({ d }) => d === path);
  expect(gapped.map(({ d }) => d)).toContain(path);
  for (const { tag, d } of paths) {
    if ((d.match(/[Mm]/g)?.length ?? 0) > 1) expect(tag).not.toMatch(/marker-(?:start|mid|end)=/);
  }
  for (const marker of ['start', 'end']) {
    const marked = paths.filter(({ tag }) => tag.includes(`marker-${marker}="url(#${marker})"`));
    expect(marked).toHaveLength(1);
    for (const { tag, d } of marked) {
      expect(d.match(/[Mm]/g)).toHaveLength(1);
      const coordinates = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
      expect(marker === 'start' ? coordinates?.slice(0, 2) : coordinates?.slice(-2)).toEqual(marker === 'start' ? [0, 0] : [200, 0]);
      expect(tag).toMatch(/(?:stroke="(?:transparent|none)"|stroke:(?:transparent|none)|(?:stroke-)?opacity[=:]"?0(?:[;" ]))/);
    }
  }
});

it('keeps comment actions separate from card controls and relationship text', () => {
  const html = renderToStaticMarkup(createElement(MeasureDiagram, {
    diagram: { nodeToVisible: {}, nodes: [{ id: 'item:app', refId: 'app', kind: 'item', label: 'App', summary: 'Runs commands', x: 0, y: 0, width: 300, height: 100 }], edges: [{ id: 'reads', source: 'item:app', target: 'item:data', childEdgeIds: ['reads'], label: 'Reads', points: [], path: '' }] },
    zoom: 'business', onMeasured: vi.fn(),
  }));
  expect(html).toContain('class="annotation-actions nodrag nopan" role="group" aria-label="Actions for App"');
  expect(html).toContain('class="annotation-actions nodrag nopan" role="group" aria-label="Actions for Reads"');
  expect(html).toContain('aria-label="Comment on App"');
  expect(html).toContain('aria-label="Comment on Reads"');
  expect(html).toContain('class="label-content" tabindex="0"');
  expect(html).not.toContain('class="card-controls"');
});

it('activates focused node and edge wrappers with Enter or Space, not nested controls', () => {
  // No DOM test environment is installed; model only the native target API this handler reads.
  class Target {
    constructor(private wrapper: boolean, private id: string) {}
    matches() { return this.wrapper; }
    getAttribute() { return this.id; }
  }
  vi.stubGlobal('Element', Target);
  const onSelect = vi.fn();
  renderToStaticMarkup(createElement(Diagram, {
    diagram: {
      nodeToVisible: { app: 'item:app' },
      nodes: [{ id: 'item:app', kind: 'item', refId: 'app', label: 'App', summary: 'Runs commands', x: 0, y: 0, width: 200, height: 100 }, { id: 'item:data', kind: 'item', refId: 'data', label: 'Data', summary: 'Keeps records', x: 300, y: 0, width: 200, height: 100 }],
      edges: [{ id: 'route', source: 'item:app', target: 'item:data', childEdgeIds: ['reads'], label: 'Reads', summary: 'Reads data', points: [], path: '', bidirectional: false }],
    },
    expanded: [], setExpanded: vi.fn(), zoom: 'business', setZoom: vi.fn(),
    selected: null, onSelect, onAnnotate: vi.fn(), commentCounts: new Map(),
  }));
  expect(edgeNames).toEqual(['App Reads Data (source to target)']);
  expect(keyDown).toBeTypeOf('function');
  const press = (key: string, target: Target) => {
    const preventDefault = vi.fn();
    keyDown!({ key, target, preventDefault } as unknown as KeyboardEvent<HTMLDivElement>);
    return preventDefault;
  };
  for (const key of ['Enter', ' ']) {
    expect(press(key, new Target(true, 'item:app'))).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenLastCalledWith('item:app');
    expect(press(key, new Target(true, 'route'))).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenLastCalledWith('edge:reads');
    onSelect.mockClear();
    expect(press(key, new Target(false, 'item:app'))).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  }
  expect(press('ArrowDown', new Target(true, 'item:app'))).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it.each(['top-to-bottom', 'left-to-right'] as const)('places card and frame handles for %s flow', orientation => {
  renderToStaticMarkup(createElement(Diagram, {
    diagram: { nodeToVisible: {}, nodes: [{ id: 'item:app', kind: 'item', refId: 'app', label: 'App', summary: 'Runs commands', x: 0, y: 0, width: 300, height: 100 }], edges: [] },
    orientation, expanded: [], setExpanded: vi.fn(), zoom: 'business', setZoom: vi.fn(),
    selected: null, onSelect: vi.fn(), onAnnotate: vi.fn(), commentCounts: new Map(),
  }));
  for (const type of ['item', 'folded-group', 'group']) {
    const html = renderToStaticMarkup(createElement(flowProps.nodeTypes![type], {
      ...flowProps.nodes![0], type, selected: false, selectable: true, deletable: false, draggable: false, isConnectable: false, dragging: false, zIndex: 1, positionAbsoluteX: 0, positionAbsoluteY: 0,
    }));
    expect(html).toContain(`data-handle="target" data-position="${orientation === 'left-to-right' ? 'left' : 'top'}"`);
    expect(html).toContain(`data-handle="source" data-position="${orientation === 'left-to-right' ? 'right' : 'bottom'}"`);
  }
});
