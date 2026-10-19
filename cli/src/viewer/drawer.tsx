import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, MessageSquare, PanelRightClose, PanelRightOpen, Pencil, Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Diagram } from './alignment-graph.js';
import { type Annotation, diagramId, pack, targetLabel } from './pack.js';
import { DesignApproval } from './design-approval.js';
import { ElementMetadata } from './element-metadata.js';
import { CommentEditor } from './comment-editor.js';
import { Dropdown, type DropdownOption } from './dropdown.js';

const labelOf = (id: string) => pack.graph.nodes.find(item => item.id === id)?.label ?? id;

export const drawerWidthLimit = (viewportWidth: number) => Math.max(280, Math.min(720, viewportWidth - 320));
export const clampDrawerWidth = (width: number, viewportWidth: number) => Math.max(280, Math.min(width, drawerWidthLimit(viewportWidth)));
export function drawerWidthForKey(key: string, width: number, viewportWidth: number): number | undefined {
  if (key === 'Home') return 280;
  if (key === 'End') return drawerWidthLimit(viewportWidth);
  if (key === 'ArrowLeft') return clampDrawerWidth(width + 20, viewportWidth);
  if (key === 'ArrowRight') return clampDrawerWidth(width - 20, viewportWidth);
  return undefined;
}

export function CommentForm({
  onSave,
  onCancel,
  focusKey,
  draftKey = 'default',
  label = 'Your comment',
  text: controlledText,
  onTextChange,
}: {
  text?: string;
  onTextChange?: (text: string) => void;
  label?: string;
  draftKey?: string;
  onSave: (comment: string) => void;
  onCancel?: () => void;
  focusKey?: number;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const text = controlledText ?? drafts[draftKey] ?? '';
  const setText = onTextChange ?? ((text: string) => setDrafts(previous => ({ ...previous, [draftKey]: text })));
  const fieldId = useId();
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
      <label className="comment-label" htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        ref={field}
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
          if (event.key === 'Escape') { event.stopPropagation(); onCancel?.(); }
        }}
        placeholder="Describe your feedback"
        rows={3}
      />
      <div className="row end">
        <span className="hint"><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> to post</span>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn primary" onClick={save} disabled={!text.trim()}>
          Post comment
        </button>
      </div>
    </div>
  );
}

export function Details({
  selected,
  diagram,
  onSelect,
  onOpenGroup,
}: {
  selected: string;
  diagram: Diagram;
  onSelect: (id: string) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  let [kind, refId] = [selected.slice(0, selected.indexOf(':')), selected.slice(selected.indexOf(':') + 1)];
  const owner = kind === 'group' ? pack.graph.groups.find(group => group.id === refId)?.ownerNodeId : undefined;
  if (owner) { kind = 'item'; refId = owner; }

  if (kind === 'edge') {
    const childIds = diagram.edges.find(edge => edge.childEdgeIds.includes(refId))?.childEdgeIds ?? [refId];
    const links = pack.graph.edges.filter(edge => childIds.includes(edge.id));
    return (
      <section className="section">
        <p className="kicker">Relationship</p>
        <h2>{links.length > 1 ? `${links.length} relationships` : links[0]?.label}</h2>
        {links.map(edge => (
          <div key={edge.id} className="link-card" data-annotate-type="edge" data-annotate-id={edge.id}>
            <dl className="link-endpoints">
              <dt>From:</dt>
              <dd><button type="button" className="relationship-link" onClick={() => onSelect(`item:${edge.fromNodeId}`)}><span>{labelOf(edge.fromNodeId)}</span><ChevronRight size={16} aria-hidden="true" /></button></dd>
              <dt>To:</dt>
              <dd><button type="button" className="relationship-link" onClick={() => onSelect(`item:${edge.toNodeId}`)}><span>{labelOf(edge.toNodeId)}</span><ChevronRight size={16} aria-hidden="true" /></button></dd>
            </dl>
            {edge.direction === 'bidirectional' && <p className="muted">Bidirectional</p>}
            {links.length > 1 && <p className="muted">{edge.label}</p>}
          </div>
        ))}
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
      </section>
    );
  }
  const node = pack.graph.nodes.find(item => item.id === refId);
  if (!node) return null;
  const links = pack.graph.edges.filter(edge => edge.fromNodeId === node.id || edge.toNodeId === node.id);
  const sources = pack.source.references.filter(ref => node.sourceRefs.includes(ref.id));
  return (
    <section className="section">
      <ElementMetadata kind={node.elementKind} channels={node.channels} />
      <h2>{node.label}</h2>
      <p data-annotate-type="node" data-annotate-id={node.id}>
        {node.summary}
      </p>
      {(node.technicalLabel || node.technicalSummary) && (
        // Collapsed by default: the business definition above is what most reviewers need.
        <details className="technical">
          <summary>
            <ChevronRight size={14} strokeWidth={2.25} className="chevron" />
            {pack.documentKind === 'design' ? 'Design detail and concerns' : 'Technical definition'}
          </summary>
          {node.technicalLabel && <p className="technical-title">{node.technicalLabel}</p>}
          {node.technicalSummary && (
            <div className="markdown" data-annotate-type="node" data-annotate-id={node.id}>
              <Markdown components={pack.documentKind === 'design' ? { img: () => null } : undefined}>{node.technicalSummary}</Markdown>
            </div>
          )}
        </details>
      )}
      <dl className="facts">
        {links.length > 0 && <dt>Relationships</dt>}
        {links.map(edge => {
          const outgoing = edge.fromNodeId === node.id;
          const other = outgoing ? edge.toNodeId : edge.fromNodeId;
          return (
            <dd key={edge.id}>
              <button type="button" className="relationship-link" onClick={() => onSelect(`edge:${edge.id}`)} data-tooltip={edge.summary}>
                <span><span className="relationship-label">{edge.label}</span><span className="relationship-endpoint">{edge.direction === 'bidirectional' ? `Both ways ↔ ${labelOf(other)}` : outgoing ? `To → ${labelOf(other)}` : `From ← ${labelOf(other)}`}</span></span><ChevronRight size={16} aria-hidden="true" />
              </button>
            </dd>
          );
        })}
        {sources.length > 0 && <dt>Source</dt>}
        {sources.map(ref => (
          <dd key={ref.id}>
            {ref.uri}
          </dd>
        ))}
      </dl>
    </section>
  );
}

export function DocumentOverview() {
  const document = pack.designDocument;
  if (!document) return null;
  return (
    <section className="section">
      <div className="section document-overview" data-annotate-type="group" data-annotate-id="design:root">
        <h2>{document.name}</h2>
        <p>{document.summary}</p>
        {document.detail && <div className="markdown"><Markdown components={{ img: () => null }}>{document.detail}</Markdown></div>}
      </div>
      <DesignApproval />
      <p className="muted">Select a component or relationship to inspect its responsibilities and concerns.</p>
    </section>
  );
}

type ShowComment = (annotation: Annotation, element: HTMLElement, keyboard: boolean) => void;

export function Comments({ annotations, onSelect, onDelete, onEdit, onShowComment, editDrafts, onEditDraft }: { editDrafts?: Record<string, string>; onEditDraft?: (id: string, text: string | undefined) => void; annotations: Annotation[]; onSelect: (id: string) => void; onDelete: (id: string) => void; onEdit: (id: string, comment: string) => void; onShowComment?: ShowComment }) {
  const [localDrafts, setLocalDrafts] = useState<Record<string, string>>({});
  const drafts = editDrafts ?? localDrafts;
  const setDraft = onEditDraft ?? ((id: string, text: string | undefined) => {
    const next = { ...localDrafts };
    if (text === undefined) delete next[id];
    else next[id] = text;
    setLocalDrafts(next);
  });
  const confirm = useRef<HTMLDialogElement>(null);
  const deleting = useRef<string | null>(null);
  const titleId = useId();
  return (
    <section className="section">
      {annotations.length === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : (
        <ul className="comments">
          {annotations.map(annotation => (
            <li key={annotation.id}>
              <div className="row between">
                <button type="button" className="link strong" onClick={() => onSelect(diagramId(annotation.target))}>
                  {targetLabel(annotation.target)}
                </button>
                <div className="row">
                  {drafts[annotation.id] === undefined && <button type="button" className="icon-btn" data-tooltip="Edit comment" aria-label="Edit comment" onClick={() => setDraft(annotation.id, annotation.comment)}><Pencil size={16} /></button>}
                  <button type="button" className="icon-btn danger" data-tooltip="Delete comment" aria-label="Delete comment" onClick={() => { deleting.current = annotation.id; confirm.current?.showModal(); }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {annotation.selectedText && <blockquote>{annotation.selectedText}</blockquote>}
              {drafts[annotation.id] !== undefined ? <CommentEditor key={annotation.id} comment={annotation.comment} text={drafts[annotation.id]} onTextChange={text => setDraft(annotation.id, text)} onCancel={() => setDraft(annotation.id, undefined)} onSave={comment => { onEdit(annotation.id, comment); setDraft(annotation.id, undefined); }} /> : <>
                <p>{annotation.comment}</p>
              </>}
              {onShowComment && <button type="button" className="btn ghost" onClick={event => onShowComment(annotation, event.currentTarget, event.detail === 0)}>Show comment</button>}
            </li>
          ))}
        </ul>
      )}
      <dialog ref={confirm} className="modal" aria-labelledby={titleId}>
        <h2 id={titleId}>Delete this comment?</h2>
        <p className="muted">This comment will be removed from this browser.</p>
        <div className="row end">
          <button type="button" className="btn ghost" autoFocus onClick={() => confirm.current?.close()}>Cancel</button>
          <button type="button" className="btn danger" onClick={() => { if (deleting.current) onDelete(deleting.current); confirm.current?.close(); }}>Delete comment</button>
        </div>
      </dialog>
    </section>
  );
}

export type DrawerView = 'details' | 'comments';
export type CommentScope = string;

export function commentScopeForSelection(selected: string | null, diagram: Diagram): CommentScope {
  if (!selected) return pack.designDocument ? 'group:design:root' : 'all';
  if (selected.startsWith('edge:')) {
    const edge = diagram.edges.find(edge => edge.id === selected || edge.childEdgeIds.includes(selected.slice(5)));
    return edge && edge.childEdgeIds.length > 1 ? `selection:${selected}` : selected;
  }
  const context = commentContext(selected, { nodes: [], edges: [], nodeToVisible: {} });
  return context ? scopeIdFor(context.target) : 'all';
}

const canonicalTarget = (target: Annotation['target']): Annotation['target'] => {
  const owner = target.type === 'group' ? pack.graph.groups.find(group => group.id === target.id)?.ownerNodeId : undefined;
  return owner ? { type: 'node', id: owner } : target;
};
const scopeIdFor = (target: Annotation['target']) => `${target.type === 'node' ? 'item' : target.type}:${target.id}`;
const scopeLabel = (target: Annotation['target']) => {
  if (target.type === 'group' && target.id === 'design:root') return 'Document';
  if (target.type === 'node') return labelOf(target.id);
  if (target.type === 'group') return pack.graph.groups.find(group => group.id === target.id)?.label ?? targetLabel(target);
  const edge = pack.graph.edges.find(edge => edge.id === target.id);
  return edge ? `${edge.label}: ${labelOf(edge.fromNodeId)} → ${labelOf(edge.toNodeId)}` : targetLabel(target);
};

export function commentScopeOptions(annotations: Annotation[]): DropdownOption[] {
  const counts = new Map<string, { target: Annotation['target']; count: number }>();
  for (const annotation of annotations) {
    const target = canonicalTarget(annotation.target);
    const id = scopeIdFor(target);
    const previous = counts.get(id);
    counts.set(id, { target, count: (previous?.count ?? 0) + 1 });
  }
  return [{ value: 'all', label: `All comments (${annotations.length})` }, ...[...counts.entries()]
    .sort(([a, first], [b, second]) => a === 'group:design:root' ? -1 : b === 'group:design:root' ? 1 : scopeLabel(first.target).localeCompare(scopeLabel(second.target)) || a.localeCompare(b))
    .map(([value, { target, count }]) => ({ value, label: `${scopeLabel(target)} (${count})` }))];
}

export function commentContext(selected: string | null, diagram: Diagram) {
  let target: Annotation['target'];
  if (!selected || selected === 'group:design:root') {
    if (!pack.designDocument) return null;
    target = { type: 'group', id: 'design:root' };
  } else {
    const separator = selected.indexOf(':');
    const kind = selected.slice(0, separator);
    const id = selected.slice(separator + 1);
    const owner = kind === 'group' ? pack.graph.groups.find(group => group.id === id)?.ownerNodeId : undefined;
    target = { type: kind === 'item' || owner ? 'node' : kind === 'edge' ? 'edge' : 'group', id: owner ?? id };
  }
  const edgeIds = target.type === 'edge' ? diagram.edges.find(edge => edge.id === selected || edge.childEdgeIds.includes(target.id))?.childEdgeIds ?? [target.id] : [];
  const matches = (candidate: Annotation['target']) => {
    if (target.type === 'edge') return candidate.type === 'edge' && edgeIds.includes(candidate.id);
    if (candidate.type === target.type && candidate.id === target.id) return true;
    return target.type === 'node' && candidate.type === 'group' && pack.graph.groups.some(group => group.id === candidate.id && group.ownerNodeId === target.id);
  };
  const label = target.id === 'design:root' && target.type === 'group' ? pack.designDocument?.name ?? 'Document' : targetLabel(target);
  return { target, matches, label };
}

export function Drawer({
  open,
  setOpen,
  view,
  setView,
  commentScope,
  setCommentScope,
  selected,
  diagram,
  focusKey,
  annotations,
  setAnnotations,
  onEdit,
  onShowComment,
  onSelect,
  onComment,
  onOpenGroup,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  view: DrawerView;
  setView: (view: DrawerView) => void;
  commentScope: CommentScope;
  setCommentScope: (scope: CommentScope) => void;
  selected: string | null;
  diagram: Diagram;
  focusKey: number;
  annotations: Annotation[];
  setAnnotations: (annotations: Annotation[]) => void;
  onEdit: (id: string, comment: string) => void;
  onShowComment?: ShowComment;
  onSelect: (id: string | null) => void;
  onComment: (target: Annotation['target'], comment: string) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({});
  const setEditDraft = (id: string, text: string | undefined) => setEditDrafts(previous => {
    const next = { ...previous };
    if (text === undefined) delete next[id];
    else next[id] = text;
    return next;
  });
  const [width, setWidth] = useState(360);
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1360 : window.innerWidth);
  const drag = useRef<{ x: number; width: number; pointer: number; handle: HTMLDivElement } | null>(null);
  useEffect(() => {
    const stop = () => {
      const active = drag.current;
      drag.current = null;
      if (active?.handle.hasPointerCapture(active.pointer)) active.handle.releasePointerCapture(active.pointer);
    };
    const resize = () => { stop(); setViewportWidth(window.innerWidth); };
    window.addEventListener('resize', resize);
    return () => { stop(); window.removeEventListener('resize', resize); };
  }, []);
  const visibleWidth = clampDrawerWidth(width, viewportWidth);
  const scopeId = useId();
  const documentContext = commentContext(null, diagram);
  // Canvas clicks retain grouped-edge context; menu choices always address exactly one commented target.
  const context = commentScope === 'all' ? documentContext : commentScope.startsWith('selection:') ? commentContext(commentScope.slice(10), diagram) : commentContext(commentScope, { ...diagram, edges: [] });
  const visibleComments = commentScope === 'all' ? annotations : annotations.filter(annotation => context?.matches(annotation.target));
  const options = commentScopeOptions(annotations);
  const currentLabel = options.find(option => option.value === commentScope)?.label ?? `${context ? scopeLabel(context.target) : 'All comments'} (${visibleComments.length})`;
  const openAllComments = () => { setCommentScope('all'); setView('comments'); setOpen(true); };
  if (!open) {
    return (
      <aside className="rail" aria-label="Details panel, collapsed">
        <button type="button" className="icon-btn" data-tooltip="Open details panel" aria-label="Open details panel" onClick={() => { setView('details'); setOpen(true); }}>
          <PanelRightOpen size={18} />
        </button>
        <button type="button" className="icon-btn rail-count" data-tooltip="All comments" aria-label={`All comments (${annotations.length})`} aria-pressed={view === 'comments' && commentScope === 'all'} onClick={openAllComments}>
          <MessageSquare size={18} />
          {annotations.length > 0 && <span className="badge">{annotations.length}</span>}
        </button>
      </aside>
    );
  }
  return (
    <aside id="drawer" className="drawer" aria-label="Details panel" style={{ '--drawer-width': `${visibleWidth}px` } as React.CSSProperties}>
      <div
        className="drawer-resize"
        role="separator"
        aria-label="Details panel width"
        aria-orientation="vertical"
        aria-controls="drawer"
        aria-valuemin={280}
        aria-valuemax={drawerWidthLimit(viewportWidth)}
        aria-valuenow={visibleWidth}
        aria-valuetext={`${visibleWidth} pixels`}
        tabIndex={0}
        onKeyDown={event => {
          const next = drawerWidthForKey(event.key, visibleWidth, window.innerWidth);
          if (next === undefined) return;
          event.preventDefault();
          setWidth(next);
        }}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width: visibleWidth, pointer: event.pointerId, handle: event.currentTarget };
        }}
        onPointerMove={event => {
          const active = drag.current;
          if (active?.pointer !== event.pointerId) return;
          event.preventDefault();
          setWidth(clampDrawerWidth(active.width + active.x - event.clientX, window.innerWidth));
        }}
        onPointerUp={event => {
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
      />
      <header className="drawer-head">
        <div className="drawer-tabs" aria-label="Panel view">
          <button type="button" aria-pressed={view === 'details'} onClick={() => setView('details')}>Details</button>
          <button type="button" aria-pressed={view === 'comments'} onClick={() => { if (view === 'details') { setCommentScope(commentScopeForSelection(selected, diagram)); setView('comments'); } }}>Comments</button>
        </div>
        <div className="row">
          <button type="button" className="icon-btn" data-tooltip="Collapse details panel" aria-label="Collapse details panel" onClick={() => setOpen(false)}>
            <PanelRightClose size={18} />
          </button>
        </div>
      </header>
      <div className="drawer-body">
        {view === 'details' ? (
          selected && selected !== 'group:design:root' ? <Details selected={selected} diagram={diagram} onSelect={onSelect} onOpenGroup={onOpenGroup} /> :
            pack.designDocument ? <DocumentOverview /> : <p className="muted">Select a box or relationship to see its details.</p>
        ) : (
          <div className="drawer-comments">
            <h2>Comments</h2>
            <div className="comment-scope">
              <label htmlFor={scopeId}>Comment scope</label>
              <Dropdown id={scopeId} label="Comment scope" value={commentScope} currentLabel={currentLabel} options={options} onChange={setCommentScope} />
            </div>
            <p className="comment-count">{visibleComments.length} comment{visibleComments.length === 1 ? '' : 's'}</p>
            {context ? <CommentForm text={drafts[scopeIdFor(context.target)] ?? ''} onTextChange={text => setDrafts(previous => ({ ...previous, [scopeIdFor(context.target)]: text }))} draftKey={scopeIdFor(context.target)} label={context.target.type === 'group' && context.target.id === 'design:root' ? 'Comment on document' : `Comment on ${scopeLabel(context.target)}`} focusKey={focusKey} onSave={comment => onComment(context.target, comment)} /> : <p className="muted">Select a box or relationship to comment on it.</p>}
            <Comments editDrafts={editDrafts} onEditDraft={setEditDraft} annotations={visibleComments} onSelect={id => { setView('details'); onSelect(id); }} onEdit={onEdit} onShowComment={onShowComment} onDelete={id => setAnnotations(annotations.filter(item => item.id !== id))} />
          </div>
        )}
      </div>
    </aside>
  );
}
