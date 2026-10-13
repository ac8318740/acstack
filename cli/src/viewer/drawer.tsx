import { useEffect, useRef, useState } from 'react';
import { ChevronRight, MessageSquare, PanelRightClose, PanelRightOpen, Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Diagram } from './alignment-graph.js';
import { type Annotation, diagramId, pack, targetLabel } from './pack.js';

const labelOf = (id: string) => pack.graph.nodes.find(item => item.id === id)?.label ?? id;

export function CommentForm({
  onSave,
  onCancel,
  focusKey,
}: {
  onSave: (comment: string) => void;
  onCancel?: () => void;
  focusKey?: number;
}) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusKey) field.current?.focus();
  }, [focusKey]);
  const save = () => {
    if (!text.trim()) return;
    onSave(text.trim());
    setText('');
  };
  return (
    <div className="comment-form">
      <textarea
        ref={field}
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save();
          if (event.key === 'Escape') onCancel?.();
        }}
        placeholder="Add a comment"
        aria-label="Comment"
        rows={3}
      />
      <div className="row end">
        <span className="hint">Ctrl + Enter</span>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn primary" onClick={save} disabled={!text.trim()}>
          Comment
        </button>
      </div>
    </div>
  );
}

function Details({
  selected,
  diagram,
  focusKey,
  onSelect,
  onComment,
  onOpenGroup,
}: {
  selected: string;
  diagram: Diagram;
  focusKey: number;
  onSelect: (id: string) => void;
  onComment: (target: Annotation['target'], comment: string) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const [kind, refId] = [selected.slice(0, selected.indexOf(':')), selected.slice(selected.indexOf(':') + 1)];
  const form = (target: Annotation['target']) => <CommentForm focusKey={focusKey} onSave={comment => onComment(target, comment)} />;

  if (kind === 'edge') {
    const childIds = diagram.edges.find(edge => edge.childEdgeIds.includes(refId))?.childEdgeIds ?? [refId];
    const links = pack.graph.edges.filter(edge => childIds.includes(edge.id));
    return (
      <section className="section">
        <p className="kicker">Link</p>
        <h2>{links.length > 1 ? `${links.length} links` : links[0]?.label}</h2>
        {links.map(edge => (
          <div key={edge.id} className="link-card" data-annotate-type="edge" data-annotate-id={edge.id}>
            <button type="button" className="link" onClick={() => onSelect(`item:${edge.fromNodeId}`)}>
              {labelOf(edge.fromNodeId)}
            </button>
            <span className="muted"> → </span>
            <button type="button" className="link" onClick={() => onSelect(`item:${edge.toNodeId}`)}>
              {labelOf(edge.toNodeId)}
            </button>
            {links.length > 1 && <p className="muted">{edge.label}</p>}
          </div>
        ))}
        {form({ type: 'edge', id: refId })}
      </section>
    );
  }
  if (kind === 'group') {
    const group = pack.graph.groups.find(item => item.id === refId);
    if (!group) return null;
    return (
      <section className="section">
        <p className="kicker">Group</p>
        <h2>{group.label}</h2>
        <p className="muted" data-annotate-type="group" data-annotate-id={group.id}>
          {group.summary}
        </p>
        <button type="button" className="btn" onClick={() => onOpenGroup(group.id)}>
          Open group
        </button>
        {form({ type: 'group', id: group.id })}
      </section>
    );
  }
  const node = pack.graph.nodes.find(item => item.id === refId);
  if (!node) return null;
  const links = pack.graph.edges.filter(edge => edge.fromNodeId === node.id || edge.toNodeId === node.id);
  const sources = pack.source.references.filter(ref => node.sourceRefs.includes(ref.id));
  return (
    <section className="section">
      <p className="kicker">Item {node.id}</p>
      <h2>{node.label}</h2>
      <p data-annotate-type="node" data-annotate-id={node.id}>
        {node.summary}
      </p>
      {(node.technicalLabel || node.technicalSummary) && (
        // Collapsed by default: the business definition above is what most reviewers need.
        <details className="technical">
          <summary>
            <ChevronRight size={14} strokeWidth={2.25} className="chevron" />
            Technical definition
          </summary>
          {node.technicalLabel && <p className="technical-title">{node.technicalLabel}</p>}
          {node.technicalSummary && (
            <div className="markdown" data-annotate-type="node" data-annotate-id={node.id}>
              <Markdown>{node.technicalSummary}</Markdown>
            </div>
          )}
        </details>
      )}
      <dl className="facts">
        {links.length > 0 && <dt>Links</dt>}
        {links.map(edge => {
          const outgoing = edge.fromNodeId === node.id;
          const other = outgoing ? edge.toNodeId : edge.fromNodeId;
          return (
            <dd key={edge.id}>
              <button type="button" className="link" onClick={() => onSelect(`item:${other}`)} title={edge.summary}>
                {outgoing ? `${edge.label} → ${labelOf(other)}` : `${labelOf(other)} → ${edge.label}`}
              </button>
            </dd>
          );
        })}
        {sources.length > 0 && <dt>Source</dt>}
        {sources.map(ref => (
          <dd key={ref.id} title={ref.uri}>
            {ref.uri}
          </dd>
        ))}
      </dl>
      {form({ type: 'node', id: node.id })}
    </section>
  );
}

function Comments({ annotations, onSelect, onDelete }: { annotations: Annotation[]; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <section className="section">
      <h3>
        Comments <span className="count-pill">{annotations.length}</span>
      </h3>
      {annotations.length === 0 ? (
        <p className="muted">Hover a box or link and click the comment icon, or highlight any text.</p>
      ) : (
        <ul className="comments">
          {annotations.map(annotation => (
            <li key={annotation.id}>
              <div className="row between">
                <button type="button" className="link strong" onClick={() => onSelect(diagramId(annotation.target))}>
                  {targetLabel(annotation.target)}
                </button>
                <button type="button" className="icon-btn" title="Delete comment" aria-label="Delete comment" onClick={() => onDelete(annotation.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              {annotation.selectedText && <blockquote>{annotation.selectedText}</blockquote>}
              <p>{annotation.comment}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Drawer({
  open,
  setOpen,
  selected,
  diagram,
  focusKey,
  annotations,
  setAnnotations,
  onSelect,
  onComment,
  onOpenGroup,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  selected: string | null;
  diagram: Diagram;
  focusKey: number;
  annotations: Annotation[];
  setAnnotations: (annotations: Annotation[]) => void;
  onSelect: (id: string | null) => void;
  onComment: (target: Annotation['target'], comment: string) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  if (!open) {
    return (
      <aside className="rail" aria-label="Details panel, collapsed">
        <button type="button" className="icon-btn" title="Open panel" aria-label="Open details panel" onClick={() => setOpen(true)}>
          <PanelRightOpen size={18} />
        </button>
        <button type="button" className="icon-btn rail-count" title="Comments" aria-label={`${annotations.length} comments`} onClick={() => setOpen(true)}>
          <MessageSquare size={18} />
          {annotations.length > 0 && <span className="badge">{annotations.length}</span>}
        </button>
      </aside>
    );
  }
  return (
    <aside id="drawer" className="drawer" aria-label="Details panel">
      <header className="drawer-head">
        <h2>Details</h2>
        <button type="button" className="icon-btn" title="Collapse panel" aria-label="Collapse details panel" onClick={() => setOpen(false)}>
          <PanelRightClose size={18} />
        </button>
      </header>
      <div className="drawer-body">
        {selected ? (
          <Details selected={selected} diagram={diagram} focusKey={focusKey} onSelect={onSelect} onComment={onComment} onOpenGroup={onOpenGroup} />
        ) : (
          <p className="muted">Select a box or link to see its details.</p>
        )}
        <Comments annotations={annotations} onSelect={onSelect} onDelete={id => setAnnotations(annotations.filter(item => item.id !== id))} />
      </div>
    </aside>
  );
}
