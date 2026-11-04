import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { designDocToPack, designFromNodes, digest, type DesignDoc } from './design-doc.js';
import { designMapInputs, readMapNodes, resolveMapNode, type ApprovalBlocker, type ElementChange } from './design-map.js';
import { openDesignReview, readDesignReviewHistories, DesignAnswerSchema, LockCaptureSchema, validateDesignAnswer, ReconciliationSchema, RevisionTupleSchema, type ApprovedElement, type DesignAnswer, type StoredDesignReview } from './design-review.js';
import { ReviewHttpError } from './review-server.js';
import { checkElementExamples, unchosenMocks, variantCapture } from './design-examples.js';
import { checkoutRoot } from './project.js';

// OpenDesigner keeps its designs in the checkout, beside the code they mock.
export function loadMapDesign(root: string, map: string, checkout = checkoutRoot() ?? process.cwd()) {
  const nodes = readMapNodes(root, map);
  const { doc, warnings } = designFromNodes(map, nodes);
  const examples = checkElementExamples(root, map, doc.items, checkout);
  for (const item of doc.items) {
    item.exampleSummaries = examples.summaries.get(item.id);
    // Binding examples are part of what a lock approves, so editing one unapproves the element.
    const bound = examples.bindings.get(item.id);
    if (bound) item.configDigest = digest([item.configDigest, bound]);
  }
  return { nodes, doc, warnings: [...warnings, ...examples.warnings] };
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
    const mine = records.filter(([id]) => id === item.id).map(([, value]) => value);
    if (!item.resolved || !mine.length || mine.some(record => record.config === item.configDigest)) continue;
    item.locked = false;
    changed.push(item.id);
    // Compare with the latest approval that kept a copy of the element; older records only know a digest.
    const latest = mine.filter(record => record.approved).sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''))[0]?.approved;
    item.changes = latest ? elementChanges(latest, approvedElement(item)) : [];
    if (!item.changes.length) item.changes = [{ label: 'Its configuration changed' }];
  }
  return changed;
}
type Item = DesignDoc['items'][number];
/** The element as approval keeps it: what a reviewer reads, not the digest. */
export function approvedElement(item: Item): ApprovedElement {
  return {
    title: item.title, name: item.name, summary: item.summary, ...(item.detailText && { detail: item.detailText }), kind: item.kind, ...(item.parent && { parent: item.parent }), channels: item.channels,
    connections: item.relationships.map(edge => ({ to: edge.to, direction: edge.direction, label: edge.label })),
    examples: Object.fromEntries((item.exampleSummaries ?? []).filter(example => !example.illustrative && example.revision).map(example => [example.path, example.revision!])),
  };
}
/** What changed between an approved element and its current form, in the reviewer's words. */
export function elementChanges(before: ApprovedElement, after: ApprovedElement): ElementChange[] {
  const changes: ElementChange[] = [];
  const text = (label: string, a?: string, b?: string) => { if (a !== b) changes.push({ label, ...(a && { before: a }), ...(b && { after: b }) }); };
  if (before.title !== undefined) text('Title changed', before.title, after.title);
  text('Name changed', before.name, after.name);
  text('Summary changed', before.summary, after.summary);
  // Detail can run long, so its before and after are clipped to a readable excerpt.
  const clip = (value?: string) => value && value.length > 400 ? `${value.slice(0, 400).trimEnd()}…` : value;
  if (before.detail !== after.detail) changes.push({ label: 'Detail changed', ...(before.detail && { before: clip(before.detail) }), ...(after.detail && { after: clip(after.detail) }) });
  text('Type changed', before.kind, after.kind);
  if (before.parent !== after.parent) changes.push({ label: 'Containment changed' });
  text('Interfaces changed', before.channels.join(', ') || 'none', after.channels.join(', ') || 'none');
  const key = (edge: ApprovedElement['connections'][number]) => `${edge.to} ${edge.label}`;
  for (const edge of after.connections) {
    const old = before.connections.find(item => key(item) === key(edge));
    if (!old) changes.push({ label: `Connection '${edge.label}' added` });
    else if (old.direction !== edge.direction) changes.push({ label: `Connection '${edge.label}' changed direction` });
  }
  for (const edge of before.connections) if (!after.connections.some(item => key(item) === key(edge))) changes.push({ label: `Connection '${edge.label}' removed` });
  for (const [path, revision] of Object.entries(after.examples)) {
    if (!(path in before.examples)) changes.push({ label: `Example ${path} added` });
    else if (before.examples[path] !== revision) changes.push({ label: `Example ${path} changed` });
  }
  for (const path of Object.keys(before.examples)) if (!(path in after.examples)) changes.push({ label: `Example ${path} removed` });
  return changes;
}
const hasRecord = (saved: StoredDesignReview, item: DesignDoc['items'][number]) => saved.lifecycle?.locks[item.id]?.config === item.configDigest;
function answerMarkdown(answer: DesignAnswer): string {
  if (answer.choices === undefined) return answer.answer;
  return [...answer.choices.map(choice => `- ${choice}`), ...(answer.answer ? [`- Other: ${answer.answer}`] : [])].join('\n');
}

/** Which elements a design change touched, as the tag on comments from before it: "before App changed". */
export function describeChange(before: DesignDoc, after: DesignDoc): string {
  const content = (item: DesignDoc['items'][number]) => JSON.stringify({ ...item, locked: undefined, resolved: undefined });
  const earlier = new Map(before.items.map(item => [item.id, item]));
  const changes = [
    ...after.items.flatMap(item => { const old = earlier.get(item.id); return !old ? [`${item.name} was added`] : content(old) !== content(item) ? [`${item.name} changed`] : []; }),
    ...before.items.filter(old => !after.items.some(item => item.id === old.id)).map(old => `${old.name} was removed`),
  ];
  if (!changes.length) return 'before the design overview changed';
  return `before ${changes.length > 3 ? `${changes.length} elements changed` : changes.join(', ')}`;
}
export type CarriedReview = { path: string; label: string };

// `carried` names reviews of earlier revisions; their comments stay visible obligations, recorded in this review.
export function openDesignLifecycle(root: string, map: string, reviewFile?: string, carried: CarriedReview[] = [], checkout = checkoutRoot() ?? process.cwd()) {
  root = resolve(root);
  const opened = loadMapDesign(root, map, checkout);
  const rendered = opened.doc;
  // An unreadable review file leaves change notes off; status reports the file instead.
  try { changedElements(rendered, reviewHistories(root, rendered.id).values()); } catch (error) { if (!(error instanceof ReviewHttpError)) throw error; }
  const review = openDesignReview(root, designDocToPack(rendered));
  const toRelative = (path: string) => relative(root, path).split(sep).join('/');
  const carry = (entries: CarriedReview[]) => review.transact(saved => {
    const kept = new Map((saved.carried ?? []).map(entry => [entry.reviewPath, entry]));
    for (const entry of entries) if (resolve(entry.path) !== review.reviewPath) kept.set(toRelative(entry.path), { reviewPath: toRelative(entry.path), label: entry.label });
    if (kept.size) saved.carried = [...kept.values()];
  });
  if (carried.length) carry(carried);
  const carriedReviews = (saved: StoredDesignReview): CarriedReview[] => (saved.carried ?? []).map(entry => ({ path: resolve(root, entry.reviewPath), label: entry.label }));
  const evaluate = (saved: StoredDesignReview) => {
    const { nodes, doc, warnings } = loadMapDesign(root, map, checkout);
    const staleRendered = doc.sourceRevision !== rendered.sourceRevision;
    const feedbackPath = reviewFile ? resolve(reviewFile) : review.reviewPath;
    const latestReceipts = new Map(saved.lifecycle?.reconciliations.map(receipt => [resolve(root, receipt.reviewPath), receipt]));
    const histories = readDesignReviewHistories(root, doc.id);
    histories.set(review.reviewPath, saved);
    // A lock is recorded in the revision it happened in, so look across every revision's record.
    const changed = changedElements(doc, histories.values());
    const inputs = designMapInputs(nodes, doc);
    const blockers = [...inputs.blockers, ...doc.items.filter(item => changed.includes(item.id))
      .map((item): ApprovalBlocker => ({ kind: 'changed', targetId: item.id, label: item.name, nodeId: item.id, ...(item.changes && { changes: item.changes }) }))];
    const earlier = carriedReviews(saved).flatMap(entry => {
      const snapshot = histories.get(entry.path);
      return snapshot?.annotations.length ? [{ reviewPath: entry.path, packVersion: snapshot.packVersion, label: entry.label, annotations: snapshot.annotations }] : [];
    });
    const obligations = new Set<string>(earlier.map(entry => entry.reviewPath));
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
    else if (inputs.blockers.some(blocker => blocker.kind === 'question')) reason = 'Open questions target this design';
    else if (changed.length) reason = 'Changed elements need re-approval';
    else if (inputs.blockers.length) reason = 'Choose a variant in each example that has several, then approve its element';
    else if (unsettled) reason = unsettled.fresh ? 'Reconciliation needs a human decision' : 'Feedback needs explicit reconciliation';
    const approved = saved.lifecycle?.approvals.some(item => sameTuple(item, tuple)) ?? false;
    const answers = Object.fromEntries(doc.questions.flatMap(question => question.answer === undefined ? [] : [[question.id, question.answer]]));
    return { ...tuple, doc, map, reviewPath: review.reviewPath, blockers, openQuestions: inputs.openQuestions, answers, locked: inputs.locked, warnings,
      approval: { valid: !reason && approved, ...(!reason && approved ? {} : { reason: reason ?? 'This revision is not approved' }) },
      feedback, feedbackPath, feedbackPaths: scopes.map(scope => scope.path), earlier, blocker: reason };
  };
  const publicStatus = (result: ReturnType<typeof evaluate>) => ({
    sourceRevision: result.sourceRevision, reviewRevision: result.reviewRevision, commentsDigest: result.commentsDigest, mapInputsDigest: result.mapInputsDigest,
    map: result.map, reviewPath: result.reviewPath, blockers: result.blockers, openQuestions: result.openQuestions, locked: result.locked,
    warnings: result.warnings, feedbackPaths: result.feedbackPaths, earlier: result.earlier, answers: result.answers, approval: result.approval,
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
    // Locking chooses a variant, so check every element before the tracker resolves any of them.
    for (const item of items) {
      // A locked element only gains a record here; it chose its variant when it locked.
      if (item.locked) continue;
      const unchosen = unchosenMocks(item, captures[item.id]);
      if (unchosen.length) throw new ReviewHttpError(409, `Element ${item.id} needs a chosen variant for ${unchosen.map(mock => `${mock.path} (${mock.variants!.join(', ')})`).join('; ')}`);
    }
    saved.lifecycle ??= { reconciliations: [], approvals: [], locks: {} };
    for (const item of items) {
      if (!item.resolved) resolveMapNode(root, map, item.id);
      saved.lifecycle.locks[item.id] = { config: item.configDigest, ...(captures[item.id] && { capture: captures[item.id] }), approved: approvedElement(item), approvedAt: new Date().toISOString() };
    }
  };
  return {
    review, doc: rendered, warnings: opened.warnings, carry,
    carried: () => review.transact(carriedReviews),
    status: () => review.transact(saved => publicStatus(evaluate(saved))),
    answer: (body: unknown) => review.transact(saved => {
      const incoming = DesignAnswerSchema.extend({ expected: RevisionTupleSchema }).strict().parse(body);
      const state = current(saved, incoming.expected);
      const question = rendered.questions.find(question => question.id === incoming.questionId);
      if (!question) throw new ReviewHttpError(400, 'Unknown design question');
      const changing = question.id in state.answers;
      if (!changing && !state.openQuestions.includes(question.id)) throw new ReviewHttpError(409, 'This question is no longer open on the map');
      const answer = { questionId: incoming.questionId, answer: incoming.answer, ...(incoming.choices && { choices: incoming.choices }) };
      validateDesignAnswer(question, answer);
      resolveMapNode(root, map, question.id, answerMarkdown(answer), changing ? new Date().toISOString().slice(0, 10) : undefined);
      return publicStatus(evaluate(saved));
    }),
    lock: (body: unknown) => review.transact(saved => {
      const incoming = z.object({ lock: z.string().min(1), capture: LockCaptureSchema.optional(), expected: RevisionTupleSchema }).strict().parse(body);
      const state = current(saved, incoming.expected);
      const item = state.doc.items.find(item => item.id === incoming.lock);
      if (!item) throw new ReviewHttpError(400, 'Unknown design element');
      if (item.locked) throw new ReviewHttpError(409, 'This element is already approved');
      lock(saved, [item], incoming.capture && { [item.id]: incoming.capture });
      return publicStatus(evaluate(saved));
    }),
    // Only on the user's explicit instruction: the agent's path to lock or re-approve one element.
    // `variants` maps each multi-variant mock's path to the variant the user named; its tweaks take their defaults.
    approveElement: (id: string, variants: Record<string, string> = {}) => review.transact(saved => {
      const item = evaluate(saved).doc.items.find(item => item.id === id);
      if (!item) throw new Error(`Unknown design element: ${id}`);
      if (item.locked && hasRecord(saved, item)) throw new Error(`Element ${id} is already approved`);
      const capture = variantCapture(item, variants, checkout);
      lock(saved, [item], capture ? { [item.id]: capture } : {});
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
