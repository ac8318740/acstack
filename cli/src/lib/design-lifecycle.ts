import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { loadDesignDoc, designDocToPack } from './design-doc.js';
import { designMapInputs, digest } from './design-map.js';
import { openDesignReview, readDesignReviewHistories, ReconciliationSchema, RevisionTupleSchema, type StoredDesignReview } from './design-review.js';
import { ReviewHttpError } from './review-server.js';

export function openDesignLifecycle(root: string, entry: string, reviewFile?: string) {
  root = resolve(root);
  entry = resolve(entry);
  const rendered = loadDesignDoc(entry);
  designMapInputs(root, rendered, entry);
  const review = openDesignReview(root, designDocToPack(rendered));
  const evaluate = (saved: StoredDesignReview) => {
    const doc = loadDesignDoc(entry);
    const staleRendered = doc.sourceRevision !== rendered.sourceRevision;
    const inputs = designMapInputs(root, doc, entry);
    const feedbackPath = reviewFile ? resolve(reviewFile) : review.reviewPath;
    const latestReceipts = new Map(saved.lifecycle?.reconciliations.map(receipt => [resolve(root, receipt.reviewPath), receipt]));
    const histories = readDesignReviewHistories(root, doc.id);
    histories.set(review.reviewPath, saved);
    const obligations = new Set<string>();
    for (const [path, snapshot] of histories) {
      const receipts = new Map(snapshot.lifecycle?.reconciliations.map(receipt => [resolve(root, receipt.reviewPath), receipt]));
      for (const [selected, receipt] of receipts) {
        // Empty current-only receipts settle contributions, not perpetual historical feedback.
        if (selected !== path || snapshot.annotations.length || receipt.decisions.some(decision => decision.outcome === 'needs-human')) obligations.add(selected);
      }
    }
    // Discovery carries paths only; freshness always comes from this authored version's receipts.
    const scopes = [...new Set([review.reviewPath, feedbackPath, ...latestReceipts.keys(), ...obligations])].sort().map(path => {
      const snapshot = histories.get(path);
      if (!snapshot) throw new Error(`Missing or invalid canonical review history: ${path}`);
      const receipt = latestReceipts.get(path);
      const fresh = receipt !== undefined && receipt.sourceRevision === doc.sourceRevision
        && receipt.mapInputsDigest === inputs.mapInputsDigest && receipt.reviewRevision === snapshot.revision
        && receipt.scopeCommentsDigest === digest(snapshot.annotations);
      return { path, snapshot, receipt, fresh };
    });
    const feedback = scopes.find(scope => scope.path === feedbackPath)!.snapshot;
    const tuple = { sourceRevision: doc.sourceRevision, reviewRevision: feedback.revision, mapInputsDigest: inputs.mapInputsDigest,
      commentsDigest: digest(scopes.map(({ path, snapshot }) => ({ path: relative(root, path).split(sep).join('/'), packVersion: snapshot.packVersion,
        revision: snapshot.revision, annotations: snapshot.annotations }))) };
    const unsettled = scopes.find(scope => (obligations.has(scope.path) || scope.receipt || scope.snapshot.annotations.length)
      && (!scope.fresh || scope.receipt?.decisions.some(decision => decision.outcome === 'needs-human')));
    let reason: string | undefined;
    if (staleRendered) reason = 'Authored source changed. Reopen this revision before reviewing.';
    else if (inputs.blockingQuestions.length) reason = 'Unresolved design decisions';
    else if (unsettled) reason = unsettled.fresh ? 'Reconciliation needs a human decision' : 'Feedback and contributions need explicit reconciliation';
    else if (inputs.contributions.length && !scopes.some(scope => scope.fresh)) reason = 'Feedback and contributions need explicit reconciliation';
    const approved = saved.lifecycle?.approvals.some(item => sameTuple(item, tuple)) ?? false;
    return { ...tuple, planning: doc.planning ?? null, reviewPath: review.reviewPath, contributions: inputs.contributions, blockingQuestions: inputs.blockingQuestions,
      approval: { valid: !reason && approved, ...(!reason && approved ? {} : { reason: reason ?? 'This revision is not approved' }) },
      feedback, feedbackPath, feedbackPaths: scopes.map(scope => scope.path), blocker: reason };
  };
  const publicStatus = (result: ReturnType<typeof evaluate>) => {
    return { sourceRevision: result.sourceRevision, reviewRevision: result.reviewRevision, commentsDigest: result.commentsDigest,
      mapInputsDigest: result.mapInputsDigest, planning: result.planning, reviewPath: result.reviewPath, contributions: result.contributions,
      blockingQuestions: result.blockingQuestions, feedbackPaths: result.feedbackPaths, approval: result.approval };
  };
  return {
    review, doc: rendered,
    status: () => review.transact(saved => publicStatus(evaluate(saved))),
    reconcile: (body: unknown) => review.transact(saved => {
      const incoming = ReconciliationSchema.parse(body);
      const state = evaluate(saved);
      if (!sameTuple(incoming, state)) throw new ReviewHttpError(409, 'Stale reconciliation tuple');
      const comments = new Set<number>();
      const contributions = new Set<string>();
      for (const decision of incoming.decisions) {
        if (!decision.comments.length && !decision.contributions.length) throw new Error('Disposition needs a reference');
        for (const index of decision.comments) {
          if (index >= state.feedback.annotations.length || comments.has(index)) throw new Error('Unknown or duplicate comment reference');
          comments.add(index);
        }
        for (const key of decision.contributions) {
          if (!state.contributions.some(item => item.key === key) || contributions.has(key)) throw new Error('Unknown or duplicate contribution reference');
          contributions.add(key);
        }
      }
      if (comments.size !== state.feedback.annotations.length || contributions.size !== state.contributions.length) throw new Error('Every comment and contribution needs a disposition');
      saved.lifecycle ??= { reconciliations: [], approvals: [] };
      saved.lifecycle.reconciliations.push({ ...incoming, reviewPath: relative(root, state.feedbackPath).split(sep).join('/'), feedbackPackVersion: state.feedback.packVersion,
        scopeCommentsDigest: digest(state.feedback.annotations), recordedAt: new Date().toISOString() });
      return publicStatus(evaluate(saved));
    }),
    approve: (body: unknown) => review.transact(saved => {
      const incoming = z.object({ decision: z.literal('approved'), expected: RevisionTupleSchema }).strict().parse(body);
      const state = evaluate(saved);
      if (!sameTuple(incoming.expected, state)) throw new ReviewHttpError(409, 'Stale approval tuple');
      if (state.blocker) throw new ReviewHttpError(409, state.blocker);
      saved.lifecycle ??= { reconciliations: [], approvals: [] };
      saved.lifecycle.approvals.push({ ...incoming.expected, recordedAt: new Date().toISOString() });
      return publicStatus(evaluate(saved));
    }),
  };
}
function sameTuple(a: z.infer<typeof RevisionTupleSchema>, b: z.infer<typeof RevisionTupleSchema>): boolean {
  return a.sourceRevision === b.sourceRevision && a.reviewRevision === b.reviewRevision && a.commentsDigest === b.commentsDigest && a.mapInputsDigest === b.mapInputsDigest;
}
