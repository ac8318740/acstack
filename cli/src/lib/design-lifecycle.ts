import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { designDocToPack, designFromNodes, digest, type DesignDoc } from './design-doc.js';
import { designMapInputs, readMapNodes, resolveMapNode, type ApprovalBlocker } from './design-map.js';
import { openDesignReview, readDesignReviewHistories, DesignAnswerSchema, LockCaptureSchema, validateDesignAnswer, ReconciliationSchema, RevisionTupleSchema, type DesignAnswer, type StoredDesignReview } from './design-review.js';
import { ReviewHttpError } from './review-server.js';

export function loadMapDesign(root: string, map: string) {
  const nodes = readMapNodes(root, map);
  return { nodes, ...designFromNodes(map, nodes) };
}
export const reviewHistories = (root: string, id: string): Map<string, StoredDesignReview> =>
  existsSync(join(root, 'design-reviews', id)) ? readDesignReviewHistories(root, id) : new Map<string, StoredDesignReview>();
/**
 * Elements whose config matches no digest the user approved. Each lock records
 * one, so an edit after locking unapproves the element until the user
 * re-approves it. The tracker node stays resolved; only the digest decides.
 */
export function changedElements(doc: DesignDoc, histories: Iterable<StoredDesignReview>): string[] {
  const records = [...histories].flatMap(snapshot => Object.entries(snapshot.lifecycle?.locks ?? {}));
  const changed: string[] = [];
  for (const item of doc.items) {
    const approved = records.filter(([id]) => id === item.id).map(([, value]) => value.config);
    if (item.resolved && approved.length && !approved.includes(item.configDigest)) { item.locked = false; changed.push(item.id); }
  }
  return changed;
}
const hasRecord = (saved: StoredDesignReview, item: DesignDoc['items'][number]) => saved.lifecycle?.locks[item.id]?.config === item.configDigest;
function answerMarkdown(answer: DesignAnswer): string {
  if (answer.choices === undefined) return answer.answer;
  return [...answer.choices.map(choice => `- ${choice}`), ...(answer.answer ? [`- Other: ${answer.answer}`] : [])].join('\n');
}

// `carried` names reviews a live session opened before the design changed; their comments stay obligations, not lost.
export function openDesignLifecycle(root: string, map: string, reviewFile?: string, carried: string[] = []) {
  root = resolve(root);
  const opened = loadMapDesign(root, map);
  const rendered = opened.doc;
  changedElements(rendered, reviewHistories(root, rendered.id).values());
  const review = openDesignReview(root, designDocToPack(rendered));
  const evaluate = (saved: StoredDesignReview) => {
    const { nodes, doc, warnings } = loadMapDesign(root, map);
    const staleRendered = doc.sourceRevision !== rendered.sourceRevision;
    const feedbackPath = reviewFile ? resolve(reviewFile) : review.reviewPath;
    const latestReceipts = new Map(saved.lifecycle?.reconciliations.map(receipt => [resolve(root, receipt.reviewPath), receipt]));
    const histories = readDesignReviewHistories(root, doc.id);
    histories.set(review.reviewPath, saved);
    // A lock is recorded in the revision it happened in, so look across every revision's record.
    const changed = changedElements(doc, histories.values());
    const inputs = designMapInputs(nodes, doc);
    const blockers = [...inputs.blockers, ...doc.items.filter(item => changed.includes(item.id))
      .map((item): ApprovalBlocker => ({ kind: 'changed', targetId: item.id, label: item.name, nodeId: item.id }))];
    const obligations = new Set<string>(carried.filter(path => histories.get(path)?.annotations.length));
    for (const [path, snapshot] of histories) {
      const receipts = new Map(snapshot.lifecycle?.reconciliations.map(receipt => [resolve(root, receipt.reviewPath), receipt]));
      for (const [selected, receipt] of receipts) {
        if (selected !== path || snapshot.annotations.length || receipt.decisions.some(decision => decision.outcome === 'needs-human')) obligations.add(selected);
      }
    }
    // Discovery carries paths only; freshness always comes from this version's receipts.
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
    const commentsDigest = digest(scopes.map(({ path, snapshot }) => ({ path: relative(root, path).split(sep).join('/'), packVersion: snapshot.packVersion, revision: snapshot.revision, annotations: snapshot.annotations })));
    const tuple = { sourceRevision: doc.sourceRevision, reviewRevision: feedback.revision, mapInputsDigest: inputs.mapInputsDigest, commentsDigest };
    const unsettled = scopes.find(scope => (obligations.has(scope.path) || scope.receipt || scope.snapshot.annotations.length)
      && (!scope.fresh || scope.receipt?.decisions.some(decision => decision.outcome === 'needs-human')));
    let reason: string | undefined;
    if (staleRendered) reason = 'The design changed on the map. Reopen this revision before reviewing.';
    else if (inputs.blockers.length) reason = 'Open questions target this design';
    else if (changed.length) reason = 'Changed elements need re-approval';
    else if (unsettled) reason = unsettled.fresh ? 'Reconciliation needs a human decision' : 'Feedback needs explicit reconciliation';
    const approved = saved.lifecycle?.approvals.some(item => sameTuple(item, tuple)) ?? false;
    return { ...tuple, doc, map, reviewPath: review.reviewPath, blockers, openQuestions: inputs.openQuestions, locked: inputs.locked, warnings,
      approval: { valid: !reason && approved, ...(!reason && approved ? {} : { reason: reason ?? 'This revision is not approved' }) },
      feedback, feedbackPath, feedbackPaths: scopes.map(scope => scope.path), blocker: reason };
  };
  const publicStatus = (result: ReturnType<typeof evaluate>) => ({
    sourceRevision: result.sourceRevision, reviewRevision: result.reviewRevision, commentsDigest: result.commentsDigest, mapInputsDigest: result.mapInputsDigest,
    map: result.map, reviewPath: result.reviewPath, blockers: result.blockers, openQuestions: result.openQuestions, locked: result.locked,
    warnings: result.warnings, feedbackPaths: result.feedbackPaths, approval: result.approval,
  });
  // Every write from the page checks the exact tuple it was shown, so a stale page cannot settle the map.
  const current = (saved: StoredDesignReview, expected: unknown) => {
    const state = evaluate(saved);
    if (state.sourceRevision !== rendered.sourceRevision) throw new ReviewHttpError(409, 'The design changed on the map. Reopen this revision first.');
    if (!sameTuple(RevisionTupleSchema.parse(expected), state)) throw new ReviewHttpError(409, 'Stale review tuple');
    return state;
  };
  // Retry-safe: an approval that failed midway left some nodes resolved, so a re-run records those without resolving them again.
  const lock = (saved: StoredDesignReview, items: DesignDoc['items'], captures: Record<string, z.infer<typeof LockCaptureSchema>> = {}) => {
    saved.lifecycle ??= { reconciliations: [], approvals: [], locks: {} };
    for (const item of items) {
      if (!item.resolved) resolveMapNode(root, map, item.id);
      saved.lifecycle.locks[item.id] = { config: item.configDigest, ...(captures[item.id] && { capture: captures[item.id] }) };
    }
  };
  return {
    review, doc: rendered, warnings: opened.warnings,
    status: () => review.transact(saved => publicStatus(evaluate(saved))),
    answer: (body: unknown) => review.transact(saved => {
      const incoming = DesignAnswerSchema.extend({ expected: RevisionTupleSchema }).strict().parse(body);
      const state = current(saved, incoming.expected);
      const question = rendered.questions.find(question => question.id === incoming.questionId);
      if (!question) throw new ReviewHttpError(400, 'Unknown design question');
      if (!state.openQuestions.includes(question.id)) throw new ReviewHttpError(409, 'This question is already settled on the map');
      const answer = { questionId: incoming.questionId, answer: incoming.answer, ...(incoming.choices && { choices: incoming.choices }) };
      validateDesignAnswer(question, answer);
      resolveMapNode(root, map, question.id, answerMarkdown(answer));
      return publicStatus(evaluate(saved));
    }),
    lock: (body: unknown) => review.transact(saved => {
      const incoming = z.object({ lock: z.string().min(1), capture: LockCaptureSchema.optional(), expected: RevisionTupleSchema }).strict().parse(body);
      const state = current(saved, incoming.expected);
      const item = state.doc.items.find(item => item.id === incoming.lock);
      if (!item) throw new ReviewHttpError(400, 'Unknown design element');
      if (item.locked) throw new ReviewHttpError(409, 'This element is already locked');
      lock(saved, [item], incoming.capture && { [item.id]: incoming.capture });
      return publicStatus(evaluate(saved));
    }),
    // Only on the user's explicit instruction: the agent's path to lock or re-approve one element.
    approveElement: (id: string) => review.transact(saved => {
      const item = evaluate(saved).doc.items.find(item => item.id === id);
      if (!item) throw new Error(`Unknown design element: ${id}`);
      if (item.locked && hasRecord(saved, item)) throw new Error(`Element ${id} is already approved`);
      lock(saved, [item]);
      return publicStatus(evaluate(saved));
    }),
    reconcile: (body: unknown) => review.transact(saved => {
      const incoming = ReconciliationSchema.parse(body);
      const state = evaluate(saved);
      if (!sameTuple(incoming, state)) throw new ReviewHttpError(409, 'Stale reconciliation tuple');
      const comments = new Set<number>();
      for (const decision of incoming.decisions) {
        if (!decision.comments.length) throw new Error('Disposition needs a reference');
        for (const index of decision.comments) {
          if (index >= state.feedback.annotations.length || comments.has(index)) throw new Error('Unknown or duplicate comment reference');
          comments.add(index);
        }
      }
      if (comments.size !== state.feedback.annotations.length) throw new Error('Every comment needs a disposition');
      saved.lifecycle ??= { reconciliations: [], approvals: [], locks: {} };
      saved.lifecycle.reconciliations.push({ ...incoming, reviewPath: relative(root, state.feedbackPath).split(sep).join('/'), feedbackPackVersion: state.feedback.packVersion,
        scopeCommentsDigest: digest(state.feedback.annotations), recordedAt: new Date().toISOString() });
      return publicStatus(evaluate(saved));
    }),
    // Approval locks every loose element; the gate already holds it while any question targets one.
    approve: (body: unknown) => review.transact(saved => {
      const incoming = z.object({ decision: z.literal('approved'), captures: z.record(LockCaptureSchema).optional(), expected: RevisionTupleSchema }).strict().parse(body);
      const state = current(saved, incoming.expected);
      if (state.blocker) throw new ReviewHttpError(409, state.blocker);
      lock(saved, state.doc.items.filter(item => !item.locked || !hasRecord(saved, item)), incoming.captures);
      saved.lifecycle!.approvals.push({ ...incoming.expected, recordedAt: new Date().toISOString() });
      return publicStatus(evaluate(saved));
    }),
  };
}

function sameTuple(a: z.infer<typeof RevisionTupleSchema>, b: z.infer<typeof RevisionTupleSchema>): boolean {
  return a.sourceRevision === b.sourceRevision && a.reviewRevision === b.reviewRevision && a.commentsDigest === b.commentsDigest && a.mapInputsDigest === b.mapInputsDigest;
}
