import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { REVIEW_TOKEN_HEADER } from '../lib/alignment-review-protocol.js';
import { liveComments, pack, token, useReviewAnnotations } from './pack.js';

type Status = {
  sourceRevision: string; reviewRevision: number; commentsDigest: string; mapInputsDigest: string;
  approval: { valid: boolean; reason?: string };
};
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
};
const ApprovalContext = createContext<ApprovalControls | null>(null);

// Both controls share the same status, confirmation, and exact-input approval request.
export function DesignApprovalProvider({ children }: { children: ReactNode }) {
  const { flush, syncState } = useReviewAnnotations();
  const enabled = liveComments && pack.documentKind === 'design';
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);
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
      const result = await request({ decision: 'approved', expected });
      setStatus(result);
      if (result.approval.valid) confirm.current?.close();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };
  const approved = Boolean(!error && !pending && syncState?.status === 'Saved' && status?.approval.valid);
  const disabled = !status || pending || approved || syncState?.status !== 'Saved';
  const reason = approved ? 'This revision is approved' : error ?? status?.approval.reason ?? 'Checking revision...';
  return <ApprovalContext.Provider value={enabled ? { approved, pending, disabled, reason, error, open: () => { if (!disabled) confirm.current?.showModal(); } } : null}>
    {children}
    {enabled && <dialog ref={confirm} className="modal" aria-labelledby="design-approval-title" aria-describedby="design-approval-explanation" onCancel={event => { if (pending) event.preventDefault(); }}>
      <h2 id="design-approval-title">Approve this version?</h2>
      <p id="design-approval-explanation">Approval covers the current design, saved comments, and map contributions. Later changes require approval again.</p>
      <p className="hint">Only posted comments are saved before approval; unposted drafts stay in this review.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row end">
        <button type="button" className="btn ghost" autoFocus disabled={pending} onClick={() => confirm.current?.close()}>Cancel</button>
        <button type="button" className="btn primary" disabled={disabled} onClick={() => void approve()}>{pending ? 'Checking revision...' : 'Approve this version'}</button>
      </div>
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
