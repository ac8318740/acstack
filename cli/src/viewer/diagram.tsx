import { useEffect } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { ChevronDown, MessageSquarePlus } from 'lucide-react';
import type { Diagram as DiagramModel, DiagramEdge, DiagramNode } from './alignment-graph.js';
import { pack } from './pack.js';

export type Zoom = 'business' | 'technical';
type Actions = { onToggle: (groupId: string) => void; onSelect: (id: string) => void; onAnnotate: (id: string) => void };
type BoxData = DiagramNode & Actions & { zoom: Zoom; dimmed: boolean; comments: number };
type RouteData = DiagramEdge & Actions & { state: 'idle' | 'active' | 'dimmed'; selectId: string; comments: number };

// Mirrors --accent and --edge in viewer.css; React Flow markers take a colour value, not a CSS variable.
const ACCENT = 'oklch(42% 0.14 262)';
const EDGE = 'oklch(55% 0.035 262)';

const itemsText = (count = 0) => `${count} item${count === 1 ? '' : 's'}`;

function sourceFile(nodeId: string): string | undefined {
  const refs = pack.graph.nodes.find(node => node.id === nodeId)?.sourceRefs ?? [];
  return pack.source.references.find(ref => refs.includes(ref.id))?.uri.split('/').at(-1);
}

function AnnotateButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="annotate nodrag nopan"
      title={label}
      aria-label={label}
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
    >
      <MessageSquarePlus size={14} strokeWidth={2} />
    </button>
  );
}

function ItemBox({ data, selected }: NodeProps<Node<BoxData>>) {
  const folded = data.kind === 'folded-group';
  const technical = data.zoom === 'technical' && !folded;
  const meta = technical ? [data.refId, sourceFile(data.refId)].filter(Boolean).join(' · ') : undefined;
  return (
    <div className={`box${folded ? ' folded' : ''}${selected ? ' selected' : ''}${data.dimmed ? ' dimmed' : ''}`}>
      <Handle type="target" position={Position.Top} />
      {data.comments > 0 && <span className="badge">{data.comments}</span>}
      <AnnotateButton label={`Comment on ${data.label}`} onClick={() => data.onAnnotate(data.id)} />
      {/* nodrag nopan lets a drag select text; a plain click still selects the box. */}
      <div
        className="box-text nodrag nopan"
        onClick={() => !window.getSelection()?.toString() && data.onSelect(data.id)}
        data-annotate-type={folded ? 'group' : 'node'}
        data-annotate-id={data.refId}
      >
        <div className="box-title">{technical ? (data.technicalLabel ?? data.label) : data.label}</div>
        <div className="box-sub">{folded ? itemsText(data.itemCount) : data.summary}</div>
        {meta && <div className="box-meta">{meta}</div>}
      </div>
      {folded && (
        <button type="button" className="link nodrag" onClick={() => data.onToggle(data.refId)}>
          Open group
        </button>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function GroupFrame({ data }: NodeProps<Node<BoxData>>) {
  return (
    <div className={`frame${data.dimmed ? ' dimmed' : ''}`}>
      <button type="button" className="frame-head nodrag" onClick={() => data.onToggle(data.refId)} aria-expanded="true" title="Fold group">
        <ChevronDown size={14} strokeWidth={2.25} />
        {data.label}
        <span className="count">{itemsText(data.itemCount)}</span>
      </button>
    </div>
  );
}

// Draws the route ELK computed, not React Flow's own, so hops and label gaps survive.
function RoutedEdge({ id, data, markerEnd }: EdgeProps<Edge<RouteData>>) {
  if (!data) return null;
  const box = data.labelBox;
  return (
    <>
      <BaseEdge id={id} path={data.path} markerEnd={markerEnd} className={data.state} interactionWidth={16} />
      {box && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label ${data.state}`}
            title={data.summary}
            style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height }}
          >
            <div
              className="edge-text nodrag nopan"
              onClick={() => !window.getSelection()?.toString() && data.onSelect(data.selectId)}
              data-annotate-type="edge"
              data-annotate-id={data.childEdgeIds[0]}
            >
              {box.lines.map(line => (
                <span key={line}>{line}</span>
              ))}
            </div>
            {data.comments > 0 && <span className="badge">{data.comments}</span>}
            <AnnotateButton label={`Comment on ${data.label}`} onClick={() => data.onAnnotate(data.selectId)} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { item: ItemBox, 'folded-group': ItemBox, group: GroupFrame };
const edgeTypes = { routed: RoutedEdge };

export function Diagram({
  diagram,
  expanded,
  setExpanded,
  zoom,
  setZoom,
  selected,
  onSelect,
  onAnnotate,
  commentCounts,
}: {
  diagram: DiagramModel;
  expanded: string[];
  setExpanded: (ids: string[]) => void;
  zoom: Zoom;
  setZoom: (zoom: Zoom) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAnnotate: (id: string) => void;
  commentCounts: Map<string, number>;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    // Never zoom past 100%: diagram text then matches the rest of the page instead of shrinking or ballooning.
    requestAnimationFrame(() => void fitView({ padding: { top: '64px', right: '32px', bottom: '32px', left: '32px' }, maxZoom: 1, duration: 200 }));
  }, [diagram, fitView]);

  const toggle = (groupId: string) => {
    onSelect(null);
    setExpanded(expanded.includes(groupId) ? expanded.filter(id => id !== groupId) : [...expanded, groupId]);
  };
  const selectedEdge = selected?.startsWith('edge:') ? diagram.edges.find(edge => edge.childEdgeIds.includes(selected.slice('edge:'.length))) : undefined;
  const linked = new Set<string>(selectedEdge ? [selectedEdge.source, selectedEdge.target] : selected ? [selected] : []);
  for (const edge of diagram.edges) {
    if (edge.source === selected) linked.add(edge.target);
    if (edge.target === selected) linked.add(edge.source);
  }
  const actions: Actions = { onToggle: toggle, onSelect, onAnnotate };
  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const nodes: Node<BoxData>[] = diagram.nodes.map(node => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    return {
      id: node.id,
      type: node.kind,
      parentId: node.parentId,
      position: { x: node.x - (parent?.x ?? 0), y: node.y - (parent?.y ?? 0) },
      style: { width: node.width, height: node.height },
      selectable: node.kind !== 'group',
      draggable: false,
      selected: node.id === selected,
      zIndex: node.kind === 'group' ? -1 : 1,
      data: { ...node, ...actions, zoom, dimmed: Boolean(selected) && node.kind !== 'group' && !linked.has(node.id), comments: commentCounts.get(node.id) ?? 0 },
    };
  });
  const edges: Edge<RouteData>[] = diagram.edges.map(edge => {
    const touches = edge === selectedEdge || edge.source === selected || edge.target === selected;
    const state = !selected ? 'idle' : touches ? 'active' : 'dimmed';
    const comments = edge.childEdgeIds.reduce((sum, id) => sum + (commentCounts.get(`edge:${id}`) ?? 0), 0);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'routed',
      data: { ...edge, ...actions, state, selectId: `edge:${edge.childEdgeIds[0]}`, comments },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: state === 'active' ? ACCENT : EDGE },
      zIndex: state === 'active' ? 2 : 0,
    };
  });

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode="light"
      nodesConnectable={false}
      minZoom={0.15}
      maxZoom={2}
      onNodeClick={(_, node) => node.type !== 'group' && onSelect(node.id)}
      onEdgeClick={(_, edge) => edge.data && onSelect(edge.data.selectId)}
      onPaneClick={() => onSelect(null)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1.2} />
      <Panel position="top-left" className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Detail level">
          {(['business', 'technical'] as const).map(value => (
            <button key={value} type="button" role="radio" aria-checked={zoom === value} onClick={() => setZoom(value)}>
              {value === 'business' ? 'Business' : 'Technical'}
            </button>
          ))}
        </div>
        <div className="segmented">
          <button type="button" onClick={() => setExpanded(pack.graph.groups.map(group => group.id))}>
            Expand all
          </button>
          <button type="button" onClick={() => setExpanded([])}>
            Collapse all
          </button>
        </div>
      </Panel>
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}
