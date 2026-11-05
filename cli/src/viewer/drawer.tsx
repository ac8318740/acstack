import { useEffect, useId, useRef, useState } from 'react';
import type { MapQuestion, ReviewAnnotation } from '../lib/alignment-packs.js';
import { Check, ChevronRight, ListFilter, ListTodo, Maximize2, MessageSquare, PanelRightClose, PanelRightOpen, Pencil, Trash2 } from 'lucide-react';
import { revealHighlights } from './markdown-highlights.js';
import { SidebarMarkdown } from './sidebar-markdown.js';
import { reconcileSelection, type Diagram } from './alignment-graph.js';
import { type Annotation, diagramId, pack, targetLabel } from './pack.js';
import { DesignApproval, ElementLock, useDesignReview } from './design-approval.js';
import { DesignQuestions, type AnswerDraft } from './design-questions.js';
import { questionScopeForSelection, questionsForScope } from './question-targets.js';
import { ElementMetadata } from './element-metadata.js';
import { CommentEditor } from './comment-editor.js';
import { Dropdown, type DropdownOption } from './dropdown.js';
import { MockContext, MocksTab, mocksFor, useMockCaptures, type MockLink } from './mocks-modal.js';

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
  highlightQuestion,
  onQuestion,
  onInspect,
  expanded = false,
  openQuestions = pack.designDocument?.questions ?? [],
}: {
  onInspect?: (selected: string) => void;
  expanded?: boolean;
  openQuestions?: MapQuestion[];
  highlightQuestion?: MapQuestion;
  onQuestion?: (id: string) => void;
  selected: string;
  diagram: Diagram;
  onSelect: (id: string) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const questions = highlightQuestion && !openQuestions.some(question => question.id === highlightQuestion.id) ? [...openQuestions, highlightQuestion] : openQuestions;
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
  const highlights = questions.flatMap(question => (question.highlights ?? []).filter(highlight => highlight.element === node.id).map(highlight => ({ ...highlight, questionId: question.id })));
  const linkedQuestions = openQuestions.filter(question => highlights.some(highlight => highlight.questionId === question.id));
  return (
    <section className="section">
      <h2>{node.label}</h2>
      <ElementMetadata kind={node.elementKind} channels={node.channels} />
      <ElementLock id={node.id} locked={node.locked} />
      <p data-annotate-type="node" data-annotate-id={node.id}>
        {node.summary}
      </p>
      {(node.technicalLabel || node.technicalSummary) && (
        // Collapsed by default: the business definition above is what most reviewers need.
        <details className="technical" open={expanded || undefined}>
          <summary>
            <ChevronRight size={14} strokeWidth={2.25} className="chevron" aria-hidden="true" />
            <span>{pack.documentKind === 'design' ? 'Design detail and concerns' : 'Technical definition'}</span>
            {onInspect && <button type="button" className="icon-btn detail-popout" aria-label="Open details in modal" aria-haspopup="dialog" data-tooltip="Open details in modal" onClick={event => { event.preventDefault(); event.stopPropagation(); onInspect(selected); }}><Maximize2 size={16} aria-hidden="true" /></button>}
          </summary>
          {node.technicalLabel && <p className="technical-title">{node.technicalLabel}</p>}
          {node.technicalSummary && (
            <div className="markdown" data-annotate-type="node" data-annotate-id={node.id}>
              <SidebarMarkdown hideImages={pack.documentKind === 'design'} highlights={highlights} navigation={onQuestion && linkedQuestions.length ? { questions: linkedQuestions, onQuestion } : null}>{node.technicalSummary}</SidebarMarkdown>
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

type DetailInspection = { selected: string; question?: MapQuestion };

function TargetDetailsDialog({ inspection, diagram, onClose, onQuestion, openQuestions }: { inspection: DetailInspection; diagram: Diagram; onClose: () => void; onQuestion: (id: string) => void; openQuestions: MapQuestion[] }) {
  const { question } = inspection;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState(inspection.selected);
  const [missingHighlight, setMissingHighlight] = useState(false);
  const highlights = question?.highlights ?? [];
  const context = [...new Set(highlights.map(highlight => highlight.element))].filter(id => selected !== `item:${id}`);
  useEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    if (!question?.highlights?.length) return;
    setMissingHighlight(!revealHighlights(modal, question.id));
  }, [question, selected]);
  return (
    <dialog ref={dialog} className="modal target-details-modal" aria-labelledby={titleId} onClose={onClose}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
      onMouseUp={event => event.stopPropagation()}>
      <header className="target-details-head">
        <div><h2 id={titleId}>Target details</h2>{highlights.length > 0 && <p className="hint">Highlighted passages relate to this question.</p>}</div>
        <button type="button" className="btn" aria-label="Close target details" autoFocus onClick={() => dialog.current?.close()}>Close</button>
      </header>
      <div className="target-details-body">
        {missingHighlight && <p role="status">These ranges contain no rendered text. Check the question's Markdown positions.</p>}
        <Details selected={selected} diagram={diagram} expanded openQuestions={openQuestions} highlightQuestion={question} onQuestion={onQuestion} onSelect={setSelected} onOpenGroup={id => setSelected(`group:${id}`)} />
        {context.length > 0 && <h3>Question context</h3>}
        {context.map(id => <Details key={id} selected={`item:${id}`} diagram={diagram} expanded openQuestions={openQuestions} highlightQuestion={question} onQuestion={onQuestion} onSelect={setSelected} onOpenGroup={id => setSelected(`group:${id}`)} />)}
      </div>
    </dialog>
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
        {document.detail && <div className="markdown"><SidebarMarkdown hideImages>{document.detail}</SidebarMarkdown></div>}
      </div>
      <DesignApproval />
      <p className="muted">Select a component or relationship to inspect its responsibilities and concerns.</p>
    </section>
  );
}

type ShowComment = (annotation: Annotation, element: HTMLElement, keyboard: boolean) => void;

export function Comments({ annotations, earlier = [], onSelect, onDelete, onEdit, onShowComment, editDrafts, onEditDraft }: { editDrafts?: Record<string, string>; onEditDraft?: (id: string, text: string | undefined) => void; annotations: Annotation[]; earlier?: Array<ReviewAnnotation & { label: string }>; onSelect: (id: string) => void; onDelete: (id: string) => void; onEdit: (id: string, comment: string) => void; onShowComment?: ShowComment }) {
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
      {annotations.length === 0 && !earlier.length ? (
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
              {annotation.mock && <MockContext nodeId={annotation.target.id} anchor={annotation.mock} />}
              {drafts[annotation.id] !== undefined ? <CommentEditor key={annotation.id} comment={annotation.comment} text={drafts[annotation.id]} onTextChange={text => setDraft(annotation.id, text)} onCancel={() => setDraft(annotation.id, undefined)} onSave={comment => { onEdit(annotation.id, comment); setDraft(annotation.id, undefined); }} /> : <>
                <p>{annotation.comment}</p>
              </>}
              {onShowComment && <button type="button" className="btn ghost" onClick={event => onShowComment(annotation, event.currentTarget, event.detail === 0)}>Show comment</button>}
            </li>
          ))}
          {/* Read-only: these belong to an earlier revision and wait for the agent to reconcile them. */}
          {earlier.map((annotation, index) => (
            <li key={`earlier:${index}`} className="earlier-comment">
              <div className="row between">
                <button type="button" className="link strong" onClick={() => onSelect(diagramId(annotation.target))}>{targetLabel(annotation.target)}</button>
              </div>
              <span className="type-pill" data-earlier>{`On an earlier version, ${annotation.label}`}</span>
              {annotation.selectedText && <blockquote>{annotation.selectedText}</blockquote>}
              <p>{annotation.comment}</p>
            </li>
          ))}
        </ul>
      )}
      <dialog ref={confirm} className="modal" aria-labelledby={titleId}>
        <h2 id={titleId}>Delete this comment?</h2>
        <p className="muted">This comment will be removed from this review.</p>
        <div className="row end">
          <button type="button" className="btn ghost" autoFocus onClick={() => confirm.current?.close()}>Cancel</button>
          <button type="button" className="btn danger" onClick={() => { if (deleting.current) onDelete(deleting.current); confirm.current?.close(); }}>Delete comment</button>
        </div>
      </dialog>
    </section>
  );
}

export type DrawerView = 'details' | 'comments' | 'questions' | 'mocks';
export type CommentScope = string;

// A collapsed container stands for everything it hides, as its card's counts do.
const folded = (selected: string | null, diagram: Diagram) => diagram.nodes.some(node => node.id === selected && node.kind === 'folded-group');
const shownAt = (selected: string, diagram: Diagram) => (id: string) => reconcileSelection(id, diagram, pack.graph) === selected;
export const mockScopeForSelection = (selected: string | null, diagram: Diagram): string => {
  if (!selected || selected === 'group:design:root') return 'all';
  if (folded(selected, diagram)) return `selection:${selected}`;
  const node = selected.startsWith('item:') ? selected.slice(5) : selected.startsWith('group:') ? pack.graph.groups.find(group => group.id === selected.slice(6))?.ownerNodeId : undefined;
  return node ? `item:${node}` : 'all';
};

export function commentScopeForSelection(selected: string | null, diagram: Diagram): CommentScope {
  if (!selected) return pack.designDocument ? 'group:design:root' : 'all';
  if (folded(selected, diagram)) return `selection:${selected}`;
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
  if (target.type === 'group' && target.id === 'design:root') return 'Document overview';
  if (target.type === 'node') return labelOf(target.id);
  if (target.type === 'group') return pack.graph.groups.find(group => group.id === target.id)?.label ?? targetLabel(target);
  const edge = pack.graph.edges.find(edge => edge.id === target.id);
  return edge ? `${edge.label}: ${labelOf(edge.fromNodeId)} → ${labelOf(edge.toNodeId)}` : targetLabel(target);
};

export const commentScopeOptions = (annotations: Annotation[]): DropdownOption[] => reviewScopeOptions(annotations.map(annotation => annotation.target));

function reviewScopeOptions(targets: Annotation['target'][]): DropdownOption[] {
  const counts = new Map<string, { target: Annotation['target']; count: number }>();
  for (const original of targets) {
    const target = canonicalTarget(original);
    const id = scopeIdFor(target);
    const previous = counts.get(id);
    counts.set(id, { target, count: (previous?.count ?? 0) + 1 });
  }
  return [{ value: 'all', label: `All targets (${targets.length})` }, ...[...counts.entries()]
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

function ReviewScope({ label, value, currentLabel, count, options, onChange }: { label: string; value: string; currentLabel: string; count: number; options: DropdownOption[]; onChange: (value: string) => void }) {
  const choices = options.some(option => option.value === value) ? options : [options[0], { value, label: `${currentLabel} (${count})` }, ...options.slice(1)];
  return <div className="review-scope" data-tooltip={`${label}: ${currentLabel} (${count})`}><Dropdown label={label} value={value} currentLabel={<><ListFilter size={14} aria-hidden="true" /><span className="scope-label">{currentLabel}</span><span className="scope-count">{count}</span></>} options={choices} onChange={onChange} /></div>;
}

export function Drawer({
  open,
  setOpen,
  view,
  setView,
  commentScope,
  setCommentScope,
  questionScope,
  setQuestionScope,
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
  mockLink,
  onOpenMock,
  questionRequest,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  view: DrawerView;
  setView: (view: DrawerView) => void;
  commentScope: CommentScope;
  setCommentScope: (scope: CommentScope) => void;
  questionScope: string;
  setQuestionScope: (scope: string) => void;
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
  // Opens the Mocks modal on one mock and variant; the caller also selects the element and shows the Mocks view.
  mockLink?: MockLink;
  // Opens a comment's mock in the Mocks modal; the app owns selection and the drawer view.
  onOpenMock?: (link: MockLink) => void;
  /** A request from outside the drawer, such as an approval blocker, to open and focus one question. */
  questionRequest?: { id: string };
}) {
  const review = useDesignReview();
  useMockCaptures();
  const authoredQuestions = pack.designDocument?.questions ?? [];
  const openQuestions = authoredQuestions.filter(question => !(review ? review.answered.includes(question.id) : question.answer !== undefined));
  const scopedQuestions = questionsForScope(authoredQuestions, questionScope, diagram, pack.graph);
  const questionOptions = reviewScopeOptions(authoredQuestions.map(question => question.target));
  const questionTarget = questionScope.startsWith('selection:') ? questionScope.slice(10) : questionScope;
  const questionContext = questionScope === 'all' ? null : commentContext(questionTarget, diagram);
  const exactQuestionScope = questionContext && scopeIdFor(questionContext.target);
  const activeQuestionScope = exactQuestionScope && questionScope.startsWith('selection:') && scopedQuestions.every(question => scopeIdFor(question.target) === exactQuestionScope) ? exactQuestionScope : questionScope;
  const questionLabel = questionContext ? scopeLabel(questionContext.target) : 'All targets';
  const needsInput = openQuestions.length;
  // The tab strip scrolls when its tabs outgrow the drawer; fades mark the hidden side.
  const tabStrip = useRef<HTMLDivElement>(null);
  const [tabFade, setTabFade] = useState({ start: false, end: false });
  const measureTabs = () => {
    const strip = tabStrip.current;
    if (!strip) return;
    const next = { start: strip.scrollLeft > 1, end: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1 };
    setTabFade(previous => previous.start === next.start && previous.end === next.end ? previous : next);
  };
  useEffect(() => {
    const strip = tabStrip.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureTabs);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [open]);
  // Tabs come and go with the selection, so check the fit after every render; the state only changes when it does.
  useEffect(measureTabs);
  useEffect(() => {
    tabStrip.current?.querySelector?.<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [view]);
  const answeredCount = authoredQuestions.length - needsInput;
  const [inspection, setInspection] = useState<DetailInspection | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, AnswerDraft>>({});
  const setAnswerDraft = (id: string, draft?: AnswerDraft) => setAnswerDrafts(previous => {
    const next = { ...previous };
    if (draft === undefined) delete next[id]; else next[id] = draft;
    return next;
  });
  const [questionFocus, setQuestionFocus] = useState<{ id: string }>();
  const openQuestion = (id: string) => {
    const question = authoredQuestions.find(question => question.id === id);
    if (!question) return;
    setInspection(null); setQuestionScope(diagramId(question.target)); setQuestionFocus({ id }); setView('questions'); setOpen(true);
  };
  useEffect(() => { if (questionRequest) openQuestion(questionRequest.id); }, [questionRequest]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({});
  const setEditDraft = (id: string, text: string | undefined) => setEditDrafts(previous => {
    const next = { ...previous };
    if (text === undefined) delete next[id];
    else next[id] = text;
    return next;
  });
  const [width, setWidth] = useState(440);
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
  const documentContext = commentContext(null, diagram);
  // Canvas clicks retain grouped-edge context; menu choices always address exactly one commented target.
  const selectionContext = (scope: string) => {
    const context = commentContext(scope, diagram);
    return context && folded(scope, diagram) ? { ...context, matches: (target: Annotation['target']) => shownAt(scope, diagram)(diagramId(target)) } : context;
  };
  const context = commentScope === 'all' ? documentContext : commentScope.startsWith('selection:') ? selectionContext(commentScope.slice(10)) : commentContext(commentScope, { ...diagram, edges: [] });
  const visibleComments = commentScope === 'all' ? annotations : annotations.filter(annotation => context?.matches(annotation.target));
  const earlierComments = (review?.earlier ?? []).flatMap(entry => entry.annotations.map(annotation => ({ ...annotation, label: entry.label })))
    .filter(annotation => commentScope === 'all' || context?.matches(annotation.target));
  const options = commentScopeOptions(annotations);
  const currentLabel = commentScope !== 'all' && context ? scopeLabel(context.target) : 'All targets';
  const mockNode = selected?.startsWith('item:') ? selected.slice(5) : selected?.startsWith('group:') ? pack.graph.groups.find(group => group.id === selected.slice(6))?.ownerNodeId ?? null : null;
  // Mocks filter like Comments and Questions: the selected element, or every mock with nothing selected.
  const mockNodes = pack.graph.nodes.filter(node => node.mocks?.length).map(node => node.id);
  const [mockScope, setMockScope] = useState(() => mockScopeForSelection(selected, diagram));
  // One rule for every tab: a filter still on the selection's own scope follows the selection, also when a
  // layout change moves it to a container. A filter the reviewer picked stays.
  const followed = useRef<{ comment: string; question: string; mock: string } | undefined>(undefined);
  useEffect(() => {
    const next = { comment: commentScopeForSelection(selected, diagram), question: questionScopeForSelection(selected), mock: mockScopeForSelection(selected, diagram) };
    const before = followed.current;
    followed.current = next;
    if (!before) return;
    if (commentScope === before.comment) setCommentScope(next.comment);
    if (questionScope === before.question) setQuestionScope(next.question);
    if (mockScope === before.mock) setMockScope(next.mock);
  }, [selected, diagram]);
  const scopedMocks = mockScope === 'all' ? mockNodes : mockScope.startsWith('selection:') ? mockNodes.filter(id => shownAt(mockScope.slice(10), diagram)(`item:${id}`)) : [mockScope.slice(5)];
  const mockCount = scopedMocks.reduce((sum, id) => sum + mocksFor(id).length, 0);
  const mockOptions = reviewScopeOptions(mockNodes.flatMap(id => mocksFor(id).map((): Annotation['target'] => ({ type: 'node', id }))));
  const mockContext = mockScope.startsWith('selection:') ? commentContext(mockScope.slice(10), diagram) : null;
  const mockLabel = mockScope === 'all' ? 'All targets' : mockContext ? scopeLabel(mockContext.target) : scopeLabel({ type: 'node', id: mockScope.slice(5) });
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
        {pack.designDocument && <button type="button" className="icon-btn rail-count" data-tooltip="Design questions" aria-label={`Questions (${needsInput} ${needsInput === 1 ? 'needs' : 'need'} input)`} onClick={() => { setQuestionScope('all'); setView('questions'); setOpen(true); }}><ListTodo size={18} aria-hidden="true" />{needsInput > 0 && <span className="badge">{needsInput}</span>}</button>}
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
        <div ref={tabStrip} className="drawer-tabs" aria-label="Panel view" data-fade-start={tabFade.start || undefined} data-fade-end={tabFade.end || undefined} onScroll={measureTabs}>
          <button type="button" aria-pressed={view === 'details'} onClick={() => setView('details')}>Details</button>
          <button type="button" aria-pressed={view === 'comments'} onClick={() => { if (view !== 'comments') { setCommentScope(commentScopeForSelection(selected, diagram)); setView('comments'); } }}>Comments</button>
          {pack.designDocument && <button type="button" aria-pressed={view === 'questions'} onClick={() => { if (view !== 'questions') { setQuestionScope(questionScopeForSelection(selected)); setView('questions'); } }}>Questions
            {needsInput > 0 && <span className="tab-count" aria-label={`${needsInput} open`}>{needsInput}</span>}
            {needsInput === 0 && answeredCount > 0 && <span className="tab-count" data-answered aria-label={`${answeredCount} answered`}><Check size={12} aria-hidden="true" />{answeredCount}</span>}
          </button>}
          {pack.designDocument && <button type="button" aria-pressed={view === 'mocks'} onClick={() => { if (view !== 'mocks') { setMockScope(mockScopeForSelection(selected, diagram)); setView('mocks'); } }}>Mocks{mockCount > 0 && <span className="tab-count" aria-label={`${mockCount} mock${mockCount === 1 ? '' : 's'}`}>{mockCount}</span>}</button>}
        </div>
        <div className="row">
          <button type="button" className="icon-btn" data-tooltip="Collapse details panel" aria-label="Collapse details panel" onClick={() => setOpen(false)}>
            <PanelRightClose size={18} />
          </button>
        </div>
      </header>
      <div className="drawer-body">
        {view === 'details' ? (
          selected && selected !== 'group:design:root' ? <Details selected={selected} diagram={diagram} openQuestions={openQuestions} onQuestion={openQuestion} onInspect={selected => setInspection({ selected })} onSelect={onSelect} onOpenGroup={onOpenGroup} /> :
            pack.designDocument ? <DocumentOverview /> : <p className="muted">Select a box or relationship to see its details.</p>
        ) : view === 'mocks' ? <div className="drawer-mocks">
          <div className="review-toolbar"><ReviewScope label="Mock scope" value={mockScope} currentLabel={mockLabel} count={mockCount} options={mockOptions} onChange={setMockScope} /></div>
          <MocksTab nodeIds={scopedMocks} empty={mockNodes.length ? 'No mocks match this filter.' : 'This design has no mocks.'} link={mockLink} annotations={annotations} setAnnotations={setAnnotations} />
        </div> : view === 'questions' ? <DesignQuestions questions={scopedQuestions} scopeControl={<ReviewScope label="Question scope" value={activeQuestionScope} currentLabel={questionLabel} count={scopedQuestions.length} options={questionOptions} onChange={setQuestionScope} />} selected={selected} diagram={diagram} focusQuestion={questionFocus} drafts={answerDrafts} onDraft={setAnswerDraft} onDetails={question => setInspection({ selected: diagramId(question.target), question })} /> : (
          <div className="drawer-comments">
            <div className="review-toolbar"><ReviewScope label="Comment scope" value={commentScope} currentLabel={currentLabel} count={visibleComments.length} options={options} onChange={setCommentScope} /></div>
            {context ? <CommentForm text={drafts[scopeIdFor(context.target)] ?? ''} onTextChange={text => setDrafts(previous => ({ ...previous, [scopeIdFor(context.target)]: text }))} draftKey={scopeIdFor(context.target)} label={context.target.type === 'group' && context.target.id === 'design:root' ? 'Comment on document' : `Comment on ${scopeLabel(context.target)}`} focusKey={focusKey} onSave={comment => onComment(context.target, comment)} /> : <p className="muted">Select a box or relationship to comment on it.</p>}
            <Comments editDrafts={editDrafts} onEditDraft={setEditDraft} annotations={visibleComments} earlier={earlierComments} onSelect={id => { setView('details'); onSelect(id); }} onEdit={onEdit} onShowComment={onShowComment || onOpenMock ? (annotation, element, keyboard) => { if (annotation.mock && onOpenMock) onOpenMock({ nodeId: annotation.target.id, path: annotation.mock.path, variant: annotation.mock.variant, comment: annotation.id }); else onShowComment?.(annotation, element, keyboard); } : undefined} onDelete={id => setAnnotations(annotations.filter(item => item.id !== id))} />
          </div>
        )}
      </div>
      {inspection && <TargetDetailsDialog inspection={inspection} diagram={diagram} openQuestions={openQuestions} onQuestion={openQuestion} onClose={() => setInspection(null)} />}
    </aside>
  );
}
