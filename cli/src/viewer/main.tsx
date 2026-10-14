import { type CSSProperties, StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { Check, CircleCheck, Copy } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './viewer.css';
import { buildDiagram, type Diagram as DiagramModel, initialExpandedGroups, NODE_HEIGHT } from './alignment-graph.js';
import { Diagram, type Zoom } from './diagram.js';
import { CommentForm, Drawer } from './drawer.js';
import type { ReviewStatus } from '../lib/alignment-packs.js';
import { REVIEW_PATH, REVIEW_TOKEN_HEADER, REVIEW_TOKEN_META } from '../lib/alignment-review-protocol.js';
import { type Annotation, type Draft, diagramId, pack, useStored } from './pack.js';

// Present only when `acstack align-viewer` served this page; a file opened directly is read-only.
const REVIEW_TOKEN = document.querySelector<HTMLMetaElement>(`meta[name="${REVIEW_TOKEN_META}"]`)?.content;

// Browsers can refuse clipboard access; the caller then shows the prompt with a Copy button instead.
const copy = (text: string): Promise<boolean> =>
  navigator.clipboard?.writeText(text).then(
    () => true,
    () => false
  ) ?? Promise.resolve(false);

const STATUS_TEXT: Record<ReviewStatus | 'pending', string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  'changes-requested': 'Changes requested',
};

// Highlighting text inside anything marked data-annotate-* opens a comment popover, as in plannotator.
function useTextSelection(popover: React.RefObject<HTMLDivElement | null>, onDraft: (draft: Draft) => void) {
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (popover.current?.contains(event.target as Node)) return;
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      const host = selection?.anchorNode?.parentElement?.closest<HTMLElement>('[data-annotate-type]');
      if (!selection || !text || !host?.dataset.annotateType || !host.dataset.annotateId) return;
      onDraft({
        target: { type: host.dataset.annotateType as Annotation['target']['type'], id: host.dataset.annotateId },
        selectedText: text,
        anchor: selection.getRangeAt(0).getBoundingClientRect(),
      });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [popover, onDraft]);
}

function App() {
  const [expanded, setExpanded] = useState(() => initialExpandedGroups(pack));
  const [zoom, setZoom] = useState<Zoom>(pack.viewState.semanticZoom === 'technical' ? 'technical' : 'business');
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [annotations, setAnnotations] = useStored<Annotation[]>('annotations', []);
  const [status, setStatus] = useState<ReviewStatus | 'pending'>(pack.reviewState.approval?.status ?? 'pending');
  // Set once the review is recorded: the prompt for the agent, and whether it reached the clipboard.
  const [sent, setSent] = useState<{ prompt: string; copied: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Blocks a second click while a review is on its way, so one decision is sent, not two.
  const [submitting, setSubmitting] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [diagram, setDiagram] = useState<DiagramModel>({ nodes: [], edges: [] });
  const popover = useRef<HTMLDivElement>(null);
  useTextSelection(popover, setDraft);
  // Beside the selection, never over it: left first, right if the left has no room, kept 8px inside the window.
  const [popoverPosition, setPopoverPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!draft || !popover.current) return setPopoverPosition({ visibility: 'hidden' });
    const { width, height } = popover.current.getBoundingClientRect();
    const { anchor } = draft;
    const gap = 12;
    const margin = 8;
    const left = anchor.left - gap - width >= margin ? anchor.left - gap - width : Math.min(anchor.right + gap, innerWidth - width - margin);
    const top = Math.min(Math.max(anchor.top + anchor.height / 2 - height / 2, margin), innerHeight - height - margin);
    setPopoverPosition({ left: Math.max(left, margin), top });
  }, [draft]);
  useEffect(() => {
    let current = true;
    // The technical view adds an id and source line, so its boxes are taller.
    void buildDiagram(pack.graph, expanded, zoom === 'technical' ? NODE_HEIGHT + 20 : NODE_HEIGHT).then(next => current && setDiagram(next));
    return () => {
      current = false;
    };
  }, [expanded, zoom]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement) && setSelected(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const addComment = (target: Annotation['target'], comment: string, selectedText?: string) => {
    setAnnotations([
      ...annotations,
      {
        id: crypto.randomUUID(),
        packVersion: pack.packVersion,
        target,
        selectedText,
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
        body: JSON.stringify({ packVersion: pack.packVersion, reviewState: { approval }, annotations: annotations.map(({ id: _id, ...rest }) => rest) }),
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
  const commentCounts = new Map<string, number>();
  for (const annotation of annotations) {
    const id = diagramId(annotation.target);
    commentCounts.set(id, (commentCounts.get(id) ?? 0) + 1);
  }
  const select = (id: string | null) => {
    setSelected(id);
    if (id) setDrawerOpen(true);
  };

  return (
    <div className="app">
      <header className="masthead">
        <h1>{pack.source.map.id}</h1>
        <span className="status" data-status={status}>
          {STATUS_TEXT[status] ?? status}
        </span>
        <span className="version" title="Your review applies to this pack version only">
          {pack.packVersion}
        </span>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
        {REVIEW_TOKEN ? (
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
          <span className="hint">Read-only copy. Run acstack align-viewer --map {pack.source.map.id} to review.</span>
        )}
      </header>
      <main className="canvas">
        <ReactFlowProvider>
          <Diagram
            diagram={diagram}
            expanded={expanded}
            setExpanded={setExpanded}
            zoom={zoom}
            setZoom={setZoom}
            selected={selected}
            onSelect={select}
            onAnnotate={id => {
              select(id);
              setFocusKey(focusKey + 1);
            }}
            commentCounts={commentCounts}
          />
        </ReactFlowProvider>
      </main>
      <Drawer
        open={drawerOpen}
        setOpen={setDrawerOpen}
        selected={selected}
        diagram={diagram}
        focusKey={focusKey}
        annotations={annotations}
        setAnnotations={setAnnotations}
        onSelect={select}
        onComment={addComment}
        onOpenGroup={groupId => {
          setSelected(null);
          setExpanded([...expanded, groupId]);
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
      {draft && (
        <div ref={popover} className="popover" role="dialog" aria-label="Comment on selection" style={popoverPosition}>
          <blockquote>{draft.selectedText}</blockquote>
          <CommentForm
            focusKey={1}
            onCancel={() => setDraft(null)}
            onSave={comment => {
              addComment(draft.target, comment, draft.selectedText);
              setDraft(null);
              window.getSelection()?.removeAllRanges();
            }}
          />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
