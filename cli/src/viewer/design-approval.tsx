import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { DesignAnswer } from '../lib/design-review.js';
import type { ApprovalBlocker, ElementChange } from '../lib/design-map.js';
import { ChevronRight } from 'lucide-react';
import type { ReviewAnnotation } from '../lib/alignment-packs.js';
import { REVIEW_TOKEN_HEADER } from '../lib/alignment-review-protocol.js';
import { liveComments, pack, token, usePackRevision, useReviewAnnotations } from './pack.js';

type Status = {
  sourceRevision: string; reviewRevision: number; commentsDigest: string; mapInputsDigest: string;
  approval: { valid: boolean; reason?: string };
  openQuestions?: string[]; answers?: Record<string, string>; locked?: string[]; blockers?: ApprovalBlocker[]; earlier?: EarlierReview[];
};
/** Comments saved on an earlier revision, tagged with the change that ended it. */
export type EarlierReview = { reviewPath: string; packVersion: string; label: string; annotations: ReviewAnnotation[] };
// What the page shows of an element when it locks, such as a mock's variant and tweaks.
export type LockCapture = Record<string, unknown>;
const BLOCKER_KINDS: Record<ApprovalBlocker['kind'], string> = { question: 'Open question', changed: 'Changed since approval', variant: 'Unchosen variant' };
async function request(body?: unknown): Promise<Status> {
  const response = await fetch('/api/design-review', {
    method: body ? 'POST' : 'GET',
    headers: { [REVIEW_TOKEN_HEADER]: token ?? '', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as Status & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'Cannot read design approval');
  return result;
}

type ApprovalControls = {
  approved: boolean; pending: boolean; disabled: boolean;
  reason: string; error?: string; open: () => void;
  answered: string[]; answerText: (id: string) => string | undefined; answerable: string[]; locked?: string[]; changed: string[]; changes: (id: string) => ElementChange[]; earlier: EarlierReview[]; canAnswer: boolean;
  saveAnswer: (answer: DesignAnswer) => Promise<void>;
  lock: (id: string) => Promise<void>;
  navigate: MutableRefObject<((blocker: ApprovalBlocker) => void) | undefined>;
  captures: MutableRefObject<Map<string, () => LockCapture | undefined>>;
};
const ApprovalContext = createContext<ApprovalControls | null>(null);
export function useDesignReview() { return useContext(ApprovalContext); }
/** Where a blocker link takes the reviewer; the app owns selection and the drawer. */
export function useBlockerNavigation(handler: (blocker: ApprovalBlocker) => void) {
  const review = useContext(ApprovalContext);
  useEffect(() => { if (review) review.navigate.current = handler; });
}
/** Lets an element's view supply what a lock, or approval, records about it. */
export function useLockCapture(id: string, capture: () => LockCapture | undefined) {
  const review = useContext(ApprovalContext);
  useEffect(() => {
    if (!review) return;
    const captures = review.captures.current;
    captures.set(id, capture);
    return () => { captures.delete(id); };
  }, [review, id, capture]);
}

// Both controls share the same status, confirmation, and exact-input approval request.
export function DesignApprovalProvider({ children }: { children: ReactNode }) {
  const { flush, syncState } = useReviewAnnotations();
  const enabled = liveComments && pack.documentKind === 'design';
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);
  const blockerDialog = useRef<HTMLDialogElement>(null);
  const navigate = useRef<((blocker: ApprovalBlocker) => void) | undefined>(undefined);
  const captures = useRef(new Map<string, () => LockCapture | undefined>());
  const captured = (ids: string[]) => Object.fromEntries(ids.flatMap(id => { const value = captures.current.get(id)?.(); return value ? [[id, value]] : []; }));
  const showBlockers = () => { confirm.current?.close(); blockerDialog.current?.showModal(); };
  // Settling the last blocker from the modal moves straight on to the approval confirmation.
  useEffect(() => {
    if (blockerDialog.current?.open && status && !status.blockers?.length) { blockerDialog.current.close(); confirm.current?.showModal(); }
  }, [status]);
  const packRevision = usePackRevision();
  useEffect(() => {
    if (!enabled || pending) return;
    let active = true;
    setStatus(undefined);
    void request().then(result => { if (active) { setStatus(result); setError(undefined); } })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  // Approval itself refreshes the inputs; finishing it must not reload and hide its result.
  }, [enabled, syncState, packRevision]);
  const approve = async () => {
    if (!status || pending || syncState?.status !== 'Saved') return;
    const { sourceRevision, reviewRevision, commentsDigest, mapInputsDigest } = status;
    const expected = { sourceRevision, reviewRevision, commentsDigest, mapInputsDigest };
    setPending(true);
    setError(undefined);
    try {
      await flush?.();
      const fresh = await request();
      if (fresh.sourceRevision !== expected.sourceRevision || fresh.reviewRevision !== expected.reviewRevision
        || fresh.commentsDigest !== expected.commentsDigest || fresh.mapInputsDigest !== expected.mapInputsDigest) {
        setStatus(fresh);
        setError('Inputs changed; review before approving');
        return;
      }
      if (fresh.blockers?.length) { setStatus(fresh); showBlockers(); return; }
      const result = await request({ decision: 'approved', expected, ...(captures.current.size && { captures: captured([...captures.current.keys()]) }) });
      setStatus(result);
      if (result.approval.valid) confirm.current?.close();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };
  // Answers and locks both resolve a map node through the server, against the exact tuple shown.
  const write = async (body: object) => {
    if (!status || pending || syncState?.status !== 'Saved') throw new Error('Wait until feedback is saved before answering.');
    const { sourceRevision, reviewRevision, commentsDigest, mapInputsDigest } = status;
    setPending(true);
    try {
      await flush?.();
      setStatus(await request({ ...body, expected: { sourceRevision, reviewRevision, commentsDigest, mapInputsDigest } }));
      setError(undefined);
    } catch (error) {
      try { setStatus(await request()); } catch { /* Keep the draft if refreshing also fails. */ }
      throw error;
    } finally { setPending(false); }
  };
  const saveAnswer = (answer: DesignAnswer) => write(answer);
  const lock = (id: string) => { const capture = captures.current.get(id)?.(); return write({ lock: id, ...(capture && { capture }) }); };
  // Until status arrives, the page's own data says which questions were answered.
  const answered = (pack.designDocument?.questions ?? []).filter(question => status?.openQuestions ? !status.openQuestions.includes(question.id) : question.answer !== undefined).map(question => question.id);
  const answerText = (id: string) => status?.answers?.[id];
  const approved = Boolean(!error && !pending && syncState?.status === 'Saved' && status?.approval.valid);
  const disabled = !status || pending || approved || syncState?.status !== 'Saved';
  const reason = approved ? 'This revision is approved' : error ?? status?.approval.reason ?? 'Checking revision...';
  return <ApprovalContext.Provider value={enabled ? { approved, pending, disabled, reason, error, answered, answerText, changes: (id: string) => (status?.blockers ?? []).flatMap(blocker => blocker.kind === 'changed' && blocker.targetId === id ? blocker.changes ?? [] : []), earlier: status?.earlier ?? [], locked: status?.locked, changed: (status?.blockers ?? []).filter(blocker => blocker.kind === 'changed').map(blocker => blocker.targetId), canAnswer: Boolean(status && !pending && syncState?.status === 'Saved'), answerable: status?.openQuestions ?? [], saveAnswer, lock, navigate, captures, open: () => { if (disabled) return; if (status?.blockers?.length) blockerDialog.current?.showModal(); else confirm.current?.showModal(); } } : null}>
    {children}
    {enabled && <dialog ref={confirm} className="modal" aria-labelledby="design-approval-title" aria-describedby="design-approval-explanation" onCancel={event => { if (pending) event.preventDefault(); }}>
      <h2 id="design-approval-title">Approve this version?</h2>
      <p id="design-approval-explanation">Approval covers every element, the saved comments, and the answered questions. Later changes need approval again.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row end">
        <button type="button" className="btn" autoFocus disabled={pending} onClick={() => confirm.current?.close()}>Cancel</button>
        <button type="button" className="btn primary" disabled={disabled} onClick={() => void approve()}>{pending ? 'Checking revision...' : 'Approve this version'}</button>
      </div>
    </dialog>}
    {enabled && <dialog ref={blockerDialog} className="modal" aria-labelledby="design-blockers-title">
      <h2 id="design-blockers-title">{`${(status?.blockers ?? []).length === 1 ? '1 item' : `${(status?.blockers ?? []).length} items`} to settle before approving`}</h2>
      <ul className="blocker-list">
        {(status?.blockers ?? []).map(blocker => <li key={`${blocker.kind}:${blocker.nodeId}`}>
          <button type="button" className="blocker-link" onClick={() => { blockerDialog.current?.close(); navigate.current?.(blocker); }}>
            <span className="blocker-text">
              <span className="blocker-label">{blocker.label}</span>
              <span className="blocker-meta">{BLOCKER_KINDS[blocker.kind]}{blocker.targetId === blocker.nodeId ? '' : ` · ${pack.graph.nodes.find(node => node.id === blocker.targetId)?.label ?? blocker.targetId}`}</span>
              {blocker.kind === 'changed' && blocker.changes?.length ? <span className="blocker-meta">{`${blocker.changes[0].label}${blocker.changes.length > 1 ? `, and ${blocker.changes.length - 1} more` : ''}`}</span> : null}
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          {blocker.kind === 'changed' && <> <button type="button" className="btn" disabled={pending} onClick={() => { void lock(blocker.targetId).catch((error: unknown) => setError(error instanceof Error ? error.message : String(error))); }}>Re-approve</button></>}
        </li>)}
      </ul>
      <div className="row end"><button type="button" className="btn" autoFocus onClick={() => blockerDialog.current?.close()}>Close</button></div>
    </dialog>}
  </ApprovalContext.Provider>;
}

export function DesignApproval({ compact = false }: { compact?: boolean }) {
  const approval = useContext(ApprovalContext);
  if (!approval) return null;
  const button = <button type="button" className={`btn ${compact ? '' : 'primary'}`} disabled={approval.disabled} onClick={approval.open} data-tooltip={compact ? approval.reason : undefined}>
    {approval.approved ? 'Approved' : approval.pending ? 'Checking revision...' : 'Approve this version'}
  </button>;
  if (compact) return button;
  return <section className="section" aria-label="Design approval">
    <h3>Revision approval</h3>
    <p className="muted" role="status">{approval.reason}</p>
    {approval.error && <p className="error" role="alert">{approval.error}</p>}
    {button}
  </section>;
}

// An element shows a state only after an agent changes it post-approval; one click approves it again.
export function ElementLock({ id }: { id: string; locked?: boolean }) {
  const review = useContext(ApprovalContext);
  const [error, setError] = useState<string>();
  if (!review?.changed.includes(id)) return null;
  const changes = review.changes(id);
  return <section className="element-changes" aria-labelledby={`changed-${id}`}>
    <h3 id={`changed-${id}`} className="element-changes-title">Changed since approval</h3>
    {changes.length > 0 && <ul className="change-list">{changes.map(change => <li key={change.label}>
      <span className="change-label">{change.label}</span>
      {(change.before !== undefined || change.after !== undefined) && <span className="change-diff"><del>{change.before ?? 'none'}</del><ins>{change.after ?? 'none'}</ins></span>}
    </li>)}</ul>}
    <button type="button" className="btn" disabled={!review.canAnswer} onClick={() => { setError(undefined); review.lock(id).catch((error: unknown) => setError(error instanceof Error ? error.message : String(error))); }}>Re-approve</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
