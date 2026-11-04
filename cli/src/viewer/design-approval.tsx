import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { DesignAnswer } from '../lib/design-review.js';
import type { ApprovalBlocker } from '../lib/design-map.js';
import { REVIEW_TOKEN_HEADER } from '../lib/alignment-review-protocol.js';
import { liveComments, pack, token, useReviewAnnotations } from './pack.js';

type Status = {
  sourceRevision: string; reviewRevision: number; commentsDigest: string; mapInputsDigest: string;
  approval: { valid: boolean; reason?: string };
  openQuestions?: string[]; locked?: string[]; blockers?: ApprovalBlocker[];
};
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
  answered: string[]; answerable: string[]; locked?: string[]; changed: string[]; canAnswer: boolean;
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
  useEffect(() => {
    if (!enabled || pending) return;
    let active = true;
    setStatus(undefined);
    void request().then(result => { if (active) { setStatus(result); setError(undefined); } })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  // Approval itself refreshes the inputs; finishing it must not reload and hide its result.
  }, [enabled, syncState]);
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
  const answered = status?.openQuestions ? (pack.designDocument?.questions ?? []).map(question => question.id).filter(id => !status.openQuestions?.includes(id)) : [];
  const approved = Boolean(!error && !pending && syncState?.status === 'Saved' && status?.approval.valid);
  const disabled = !status || pending || approved || syncState?.status !== 'Saved';
  const reason = approved ? 'This revision is approved' : error ?? status?.approval.reason ?? 'Checking revision...';
  return <ApprovalContext.Provider value={enabled ? { approved, pending, disabled, reason, error, answered, locked: status?.locked, changed: (status?.blockers ?? []).filter(blocker => blocker.kind === 'changed').map(blocker => blocker.targetId), canAnswer: Boolean(status && !pending && syncState?.status === 'Saved'), answerable: status?.openQuestions ?? [], saveAnswer, lock, navigate, captures, open: () => { if (disabled) return; if (status?.blockers?.length) blockerDialog.current?.showModal(); else confirm.current?.showModal(); } } : null}>
    {children}
    {enabled && <dialog ref={confirm} className="modal" aria-labelledby="design-approval-title" aria-describedby="design-approval-explanation" onCancel={event => { if (pending) event.preventDefault(); }}>
      <h2 id="design-approval-title">Approve this version?</h2>
      <p id="design-approval-explanation">Approval covers the current design, saved comments, and the questions on the map, and locks every loose element. Later changes require approval again.</p>
      <p className="hint">Only posted comments are saved before approval; unposted drafts stay in this review.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row end">
        <button type="button" className="btn ghost" autoFocus disabled={pending} onClick={() => confirm.current?.close()}>Cancel</button>
        <button type="button" className="btn primary" disabled={disabled} onClick={() => void approve()}>{pending ? 'Checking revision...' : 'Approve this version'}</button>
      </div>
    </dialog>}
    {enabled && <dialog ref={blockerDialog} className="modal" aria-labelledby="design-blockers-title" aria-describedby="design-blockers-explanation">
      <h2 id="design-blockers-title">Settle these before approving</h2>
      <p id="design-blockers-explanation">{status?.approval.reason ?? 'This revision has blockers.'} Choose one to open it.</p>
      <ul className="blocker-list">
        {(status?.blockers ?? []).map(blocker => <li key={`${blocker.kind}:${blocker.nodeId}`}>
          <button type="button" className="link" onClick={() => { blockerDialog.current?.close(); navigate.current?.(blocker); }}>{blocker.label}</button>
          <span className="muted"> {BLOCKER_KINDS[blocker.kind]} · {pack.graph.nodes.find(node => node.id === blocker.targetId)?.label ?? blocker.targetId}</span>
          {blocker.kind === 'changed' && <> <button type="button" className="btn" disabled={pending} onClick={() => { void lock(blocker.targetId).catch((error: unknown) => setError(error instanceof Error ? error.message : String(error))); }}>Re-approve</button></>}
        </li>)}
      </ul>
      <div className="row end"><button type="button" className="btn ghost" autoFocus onClick={() => blockerDialog.current?.close()}>Close</button></div>
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
    <p className="hint">Only posted comments are saved before approval; unposted drafts stay in this review.</p>
  </section>;
}

// Only the reviewer locks an element; a locked element is a requirement.
export function ElementLock({ id, locked }: { id: string; locked?: boolean }) {
  const review = useContext(ApprovalContext);
  const [error, setError] = useState<string>();
  if (locked === undefined) return null;
  const isLocked = review?.locked ? review.locked.includes(id) : locked;
  const changed = review?.changed.includes(id) ?? false;
  return <div className="element-lock">
    <span className="type-pill" data-locked={isLocked}>{isLocked ? 'Locked' : changed ? 'Changed since approval' : 'Loose'}</span>
    {review && !isLocked && <button type="button" className="btn" disabled={!review.canAnswer} onClick={() => { setError(undefined); review.lock(id).catch((error: unknown) => setError(error instanceof Error ? error.message : String(error))); }}>{changed ? 'Re-approve' : 'Lock'}</button>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
