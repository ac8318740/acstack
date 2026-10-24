import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { Check, CircleCheck, Copy } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './viewer.css';
import { buildDiagram, type Diagram as DiagramModel, initialExpandedGroups, projectDiagram, reconcileSelection, type MeasuredGeometry } from './alignment-graph.js';
import { Diagram, MeasureDiagram, type MeasureDiagramHandle, type ViewportAnchor, type Zoom } from './diagram.js';
import { CommentForm, Drawer, commentScopeForSelection, type CommentScope, type DrawerView } from './drawer.js';
import { commentPosition } from './comment-position.js';
import { bindTextSelection } from './text-selection.js';
import { captureQuoteAnchor, toReviewAnnotation } from './quote-anchors.js';
import { usePostedComments } from './posted-comments.js';
import { AppTooltipLayer } from './tooltip.js';
import type { ReviewStatus } from '../lib/alignment-packs.js';
import { REVIEW_PATH, REVIEW_TOKEN_HEADER, REVIEW_TOKEN_META } from '../lib/alignment-review-protocol.js';
import { copy, ReviewHandoff } from './review-handoff.js';
import { DesignApproval, DesignApprovalProvider } from './design-approval.js';
import { type Annotation, type Draft, annotationId, diagramId, pack, liveComments, handoffPrompt, useReviewAnnotations } from './pack.js';

const orientation = pack.viewState.orientation ?? (pack.documentKind === 'design' ? 'top-to-bottom' : 'left-to-right');

// Present only when `acstack align-viewer` served this page; a file opened directly is read-only.
const REVIEW_TOKEN = document.querySelector<HTMLMetaElement>(`meta[name="${REVIEW_TOKEN_META}"]`)?.content;


const STATUS_TEXT: Record<ReviewStatus | 'pending', string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  'changes-requested': 'Changes requested',
};

// Highlighting text inside anything marked data-annotate-* opens a comment popover, as in plannotator.
function useTextSelection(popover: React.RefObject<HTMLDivElement | null>, onDraft: (draft: Draft | null) => void) {
  const binding = useRef<ReturnType<typeof bindTextSelection> | null>(null);
  useEffect(() => {
    const current = bindTextSelection(popover, onDraft);
    binding.current = current;
    return () => { current.dispose(); binding.current = null; };
  }, [popover, onDraft]);
  return useCallback(() => binding.current?.dismiss(), []);
}

function App() {
  const [expanded, setExpanded] = useState(() => initialExpandedGroups(pack));
  const [zoom, setZoom] = useState<Zoom>(pack.viewState.semanticZoom === 'technical' ? 'technical' : 'business');
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerView, setDrawerView] = useState<DrawerView>('details');
  const [commentScope, setCommentScope] = useState<CommentScope>('all');
  const { annotations, setAnnotations, syncState, retry, flush } = useReviewAnnotations();
  const [status, setStatus] = useState<ReviewStatus | 'pending'>(pack.reviewState.approval?.status ?? 'pending');
  // Set once the review is recorded: the prompt for the agent, and whether it reached the clipboard.
  const [sent, setSent] = useState<{ prompt: string; copied: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Blocks a second click while a review is on its way, so one decision is sent, not two.
  const [submitting, setSubmitting] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [diagram, setDiagram] = useState<DiagramModel>({ nodes: [], edges: [], nodeToVisible: {} });
  const [layoutKey, setLayoutKey] = useState('');
  const [layoutZoom, setLayoutZoom] = useState(zoom);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const requestedKey = `${[...expanded].sort().join('|')}:${zoom}`;
  const previousLayout = useRef<{ key: string; diagram: DiagramModel } | null>(null);
  const acceptedLayout = useRef<DiagramModel | undefined>(undefined);
  const viewportAnchor = useRef<ViewportAnchor | null>(null);
  const changeExpanded = (ids: string[], anchorId?: string) => {
    generation.current += 1;
    const key = `${[...ids].sort().join('|')}:${zoom}`;
    const node = diagram.nodes.find(node => node.id === anchorId);
    previousLayout.current = { key, diagram };
    viewportAnchor.current = node ? { key, before: diagram, node: { id: node.id, x: node.x, y: node.y } } : null;
    setExpanded(ids);
  };
  const projection = useMemo(() => projectDiagram(pack.graph, expanded), [expanded]);
  const [measurement, setMeasurement] = useState<{ key: string; geometry: MeasuredGeometry } | null>(null);
  const onMeasured = useCallback((geometry: MeasuredGeometry) => {
    setMeasurement(previous => previous?.key === requestedKey && JSON.stringify(previous.geometry) === JSON.stringify(geometry) ? previous : { key: requestedKey, geometry });
  }, [requestedKey]);
  const generation = useRef(0);
  const measurementTree = useRef<MeasureDiagramHandle>(null);
  const popover = useRef<HTMLDivElement>(null);
  const dismissDraft = useTextSelection(popover, setDraft);
  const editComment = (id: string, comment: string) => {
    setAnnotations(annotations.map(annotation => annotation.id === id ? { ...annotation, comment } : annotation));
  };
  const postedComments = usePostedComments(annotations, Boolean(draft), dismissDraft, editComment);
  // Observe the visible canvas, not the window: resizing the drawer must move an open comment too.
  useLayoutEffect(() => {
    const element = popover.current;
    const app = element?.closest('.app');
    const canvas = app?.querySelector<HTMLElement>('.canvas');
    const drawer = app?.querySelector<HTMLElement>('.drawer');
    if (!draft || !element || !canvas) return;
    const range = draft.range;
    const fromDrawer = Boolean(range && drawer?.contains(range.commonAncestorContainer));
    const position = () => {
      const anchor = range?.startContainer.isConnected ? range.getBoundingClientRect() : draft.anchor;
      const canvasRect = canvas.getBoundingClientRect();
      const drawerRect = drawer?.getBoundingClientRect();
      const viewport = { width: innerWidth, height: innerHeight };
      const bounds = commentPosition(anchor, canvasRect, drawerRect, element.getBoundingClientRect(), viewport, fromDrawer);
      element.style.maxWidth = `${bounds.maxWidth}px`;
      element.style.maxHeight = `${bounds.maxHeight}px`;
      const placed = commentPosition(anchor, canvasRect, drawerRect, element.getBoundingClientRect(), viewport, fromDrawer);
      element.style.left = `${placed.left}px`;
      element.style.top = `${placed.top}px`;
      element.style.visibility = 'visible';
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(canvas);
    observer.observe(element);
    if (drawer) observer.observe(drawer);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [draft, drawerOpen]);
  const previousCounts = useRef(new Map<string, number>());
  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      const id = diagramId(annotation.target);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (counts.size === previousCounts.current.size && [...counts].every(([id, count]) => previousCounts.current.get(id) === count)) return previousCounts.current;
    previousCounts.current = counts;
    return counts;
  }, [annotations]);
  useEffect(() => {
    const request = ++generation.current;
    if (measurement?.key !== requestedKey) return;
    const previous = previousLayout.current?.key === requestedKey ? previousLayout.current.diagram : acceptedLayout.current;
    const measurer = measurementTree.current;
    void buildDiagram(pack.graph, expanded, measurement.geometry, previous, orientation, nodes => {
      if (request !== generation.current || measurementTree.current !== measurer) throw new Error('Layout request superseded');
      return measurer?.measureHeaders(nodes) ?? {};
    }).then(next => {
      if (request !== generation.current) return;
      if (measurementTree.current !== measurer) return;
      previousLayout.current = null;
      acceptedLayout.current = next;
      setDiagram(next);
      setLayoutKey(requestedKey);
      setLayoutZoom(zoom);
      setSelected(previous => reconcileSelection(previous, next, pack.graph));
      setLayoutError(null);
    }).catch((error: unknown) => {
      if (measurementTree.current !== measurer) return;
      if (request === generation.current) setLayoutError(error instanceof Error ? error.message : String(error));
    });
    return () => { generation.current += 1; };
  }, [expanded, measurement, requestedKey, zoom, commentCounts]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && !(event.target as Element | null)?.closest?.('[data-review-handoff]') && !event.defaultPrevented && !(event.target instanceof HTMLTextAreaElement) && setSelected(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const addComment = (target: Annotation['target'], comment: string, selectedText?: string, quoteAnchor?: Annotation['quoteAnchor']) => {
    setAnnotations([
      ...annotations,
      {
        id: annotationId(),
        packVersion: pack.packVersion,
        target,
        selectedText,
        quoteAnchor,
        comment,
        time: new Date().toISOString(),
      },
    ]);
    setDrawerOpen(true);
  };
  // Posts the decision to the acstack process that served this page; it records the review on that machine.
  const submit = async (decision: ReviewStatus) => {
    if (submitting) return;
    confirm.current?.close();
    setSubmitting(true);
    setError(null);
    const approval = { packVersion: pack.packVersion, status: decision, approvedAt: new Date().toISOString() };
    try {
      const res = await fetch(REVIEW_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [REVIEW_TOKEN_HEADER]: REVIEW_TOKEN ?? '' },
        body: JSON.stringify({ packVersion: pack.packVersion, reviewState: { approval }, annotations: annotations.map(toReviewAnnotation) }),
      });
      const body = (await res.json()) as { error?: string; prompt?: string };
      if (!res.ok) throw new Error(body.error ?? `Review failed (${res.status})`);
      const prompt = body.prompt ?? '';
      setStatus(decision);
      setAnnotations([]);
      setSent({ prompt, copied: await copy(prompt) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };
  const select = (id: string | null) => {
    setSelected(reconcileSelection(id, diagram, pack.graph));
    if (id) {
      setDrawerOpen(true);
      if (drawerView !== 'details') setCommentScope(commentScopeForSelection(id, diagram));
    }
  };

  return (
    <div className="app">
      <AppTooltipLayer />
      <header className="masthead">
        <h1>{pack.source.map.id}</h1>
        <span className="status" data-status={status}>
          {pack.documentKind === 'design' ? 'Design document' : STATUS_TEXT[status] ?? status}
        </span>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
        <div className="row review-controls">
          <span className="version" tabIndex={0} data-tooltip={`Pack version: ${pack.packVersion}. Comments apply to this version.`}>
            {pack.packVersion.slice(-8)}
          </span>
          {liveComments ? (
            <div className="actions">
              <span className="hint" role="status">{syncState?.status ?? 'Saving'}</span>
              {syncState?.status === 'Not synced' && <button type="button" className="btn" onClick={retry}>Retry</button>}
              <DesignApproval compact />
              {handoffPrompt && flush && <ReviewHandoff prompt={handoffPrompt} flush={flush} />}
            </div>
          ) : REVIEW_TOKEN ? (
            <div className="actions">
              {/* Approve stays rightmost so it never moves when Request changes appears. */}
              {annotations.length > 0 && (
                <button type="button" className="btn" disabled={submitting} onClick={() => void submit('changes-requested')}>
                  Request changes <span className="count-pill">{annotations.length}</span>
                </button>
              )}
              <button
                type="button"
                className="btn primary"
                disabled={submitting}
                onClick={() => (annotations.length ? confirm.current?.showModal() : void submit('approved'))}
              >
                Approve
              </button>
            </div>
          ) : (
            <span className="hint">{pack.documentKind === 'design' ? 'Comments stay in this browser. Approval is not recorded.' : 'Read-only legacy copy. Use design-review migrate with an authored entry and explicit mapping, then open design-doc.'}</span>
          )}
          {liveComments && syncState?.error && <span className="error" role="alert">{syncState.error}</span>}
        </div>
      </header>
      <main className="canvas">
        <MeasureDiagram ref={measurementTree} diagram={projection} zoom={zoom} commentCounts={commentCounts} onMeasured={onMeasured} />
        {layoutError && <div className="layout-error" role="alert">{layoutError} The previous valid diagram remains visible.</div>}
        <ReactFlowProvider>
          <Diagram
            diagram={diagram}
            orientation={orientation}
            layoutKey={layoutKey}
            anchor={viewportAnchor.current}
            expanded={expanded}
            setExpanded={changeExpanded}
            zoom={zoom}
            contentZoom={layoutZoom}
            setZoom={value => {
              if (value === zoom) return;
              generation.current += 1;
              previousLayout.current = null;
              viewportAnchor.current = null;
              setZoom(value);
            }}
            selected={selected}
            onSelect={select}
            onAnnotate={id => {
              select(id);
              setCommentScope(commentScopeForSelection(id, diagram));
              setDrawerView('comments');
              setFocusKey(focusKey + 1);
            }}
            commentCounts={commentCounts}
          />
        </ReactFlowProvider>
      </main>
      <Drawer
        open={drawerOpen}
        setOpen={setDrawerOpen}
        view={drawerView}
        setView={setDrawerView}
        commentScope={commentScope}
        setCommentScope={setCommentScope}
        selected={selected}
        diagram={diagram}
        focusKey={focusKey}
        annotations={annotations}
        setAnnotations={setAnnotations}
        onEdit={editComment}
        onShowComment={postedComments.show}
        onSelect={id => {
          setDrawerView('details');
          if (id === 'group:design:root') setSelected(null);
          else if (id?.startsWith('edge:')) setSelected(id);
          else setSelected(reconcileSelection(id, diagram, pack.graph));
          setDrawerOpen(true);
        }}
        onComment={addComment}
        onOpenGroup={groupId => {
          setSelected(null);
          changeExpanded([...expanded, groupId], `group:${groupId}`);
        }}
      />
      <dialog ref={confirm} className="modal" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Approve with {annotations.length} open comment{annotations.length === 1 ? '' : 's'}?</h2>
        <p className="muted">Your comments have not been sent as change requests. Approving sends them as notes only.</p>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={() => confirm.current?.close()}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={submitting} onClick={() => void submit('approved')}>
            Approve anyway
          </button>
          <button type="button" className="btn primary" disabled={submitting} onClick={() => void submit('changes-requested')}>
            Request changes
          </button>
        </div>
      </dialog>
      {sent && (
        <div className="done" role="status">
          <CircleCheck size={32} className="done-icon" />
          <h2>{status === 'approved' ? 'Approved' : 'Changes requested'}</h2>
          <p className="muted">
            {sent.copied ? 'Prompt copied. Paste it into your agent’s chat.' : 'Copy this prompt into your agent’s chat.'}
          </p>
          <pre className="prompt">{sent.prompt}</pre>
          <button type="button" className="btn" onClick={() => void copy(sent.prompt).then(copied => setSent({ ...sent, copied }))}>
            {sent.copied ? <Check size={14} /> : <Copy size={14} />}
            {sent.copied ? 'Copied' : 'Copy prompt'}
          </button>
          <p className="hint">You can close this tab.</p>
        </div>
      )}
      {postedComments.content}
      {draft && (
        <div ref={popover} className="popover" role="dialog" aria-label="Comment on selection">
          <blockquote>{draft.selectedText}</blockquote>
          <CommentForm
            focusKey={1}
            onCancel={dismissDraft}
            onSave={comment => {
              addComment(draft.target, comment, draft.selectedText, draft.selectedText ? captureQuoteAnchor(draft.range, draft.target, draft.selectedText) ?? null : undefined);
              dismissDraft();
            }}
          />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <DesignApprovalProvider><App /></DesignApprovalProvider>
  </StrictMode>
);
