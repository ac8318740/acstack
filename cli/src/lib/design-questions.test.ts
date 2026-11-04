import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { loadDesignDoc, designDocToPack, renderDesignDocMarkdown } from './design-doc.js';
import { openDesignLifecycle } from './design-lifecycle.js';

// Lifecycle tests do not render the multi-megabyte offline viewer bundle.
vi.mock('./alignment-viewer.generated.js', () => ({ VIEWER_CSS: '', VIEWER_JS: '' }));

const roots: string[] = [];
const question = { id: 'conflicts', target: { type: 'node', id: 'app' }, question: 'Require a fresh preview after a conflicting edit?', proposal: 'Never overwrite intervening edits.', recommendation: 'Require a new preview to avoid data loss.' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-questions-'));
  roots.push(root);
  const entry = { id: 'example', name: 'Example', summary: 'Inspect changes', elements: ['app.yaml'], questions: [question] };
  const path = join(root, 'design.yaml');
  const save = (value: unknown) => writeFileSync(path, stringify(value));
  writeFileSync(join(root, 'app.yaml'), 'id: app\nname: App\nsummary: Applies edits\nkind: component\n');
  save(entry);
  return { root, path, entry, save, open: (reviewFile?: string) => openDesignLifecycle(root, path, reviewFile) };
}
const tuple = (value: { sourceRevision: string; reviewRevision: number; commentsDigest: string; mapInputsDigest: string }) => ({ sourceRevision: value.sourceRevision, reviewRevision: value.reviewRevision, commentsDigest: value.commentsDigest, mapInputsDigest: value.mapInputsDigest });
const disposition = { comments: [], contributions: [], answers: [0], outcome: 'retained', rationale: 'Keep the preview requirement.' };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('carries contextual questions into the viewer, companion, and source identity', () => {
  const f = fixture();
  const doc = loadDesignDoc(f.path);
  expect(designDocToPack(doc).designDocument).toMatchObject({ questions: [question] });
  const markdown = renderDesignDocMarkdown(doc);
  for (const value of [question.question, question.proposal, question.recommendation, 'app']) expect(markdown).toContain(value);
  f.save({ ...f.entry, questions: [{ ...question, recommendation: 'Ask before retrying.' }] });
  expect(loadDesignDoc(f.path).sourceRevision).not.toBe(doc.sourceRevision);
  expect(designDocToPack(loadDesignDoc(f.path)).packVersion).not.toBe(designDocToPack(doc).packVersion);
});

it('rejects unknown, mismatched, duplicate, or empty authored questions', () => {
  const f = fixture();
  for (const questions of [[{ ...question, target: { type: 'node', id: 'missing' } }], [{ ...question, target: { type: 'edge', id: 'app' } }], [question, question], [{ ...question, proposal: ' ' }]]) {
    f.save({ ...f.entry, questions });
    expect(() => loadDesignDoc(f.path)).toThrow();
  }
});

it('validates question highlight ranges against declared element Markdown and binds them to the revision', () => {
  const f = fixture();
  writeFileSync(join(f.root, 'app.yaml'), 'id: app\nname: App\nsummary: Applies edits\nkind: component\ndetail: app.md\n');
  writeFileSync(join(f.root, 'app.md'), '# Context\r\n\r\nKeep **drafts**.\r\n');
  const highlight = { element: 'app', start: { line: 3, column: 8 }, end: { line: 3, column: 14 } };
  f.save({ ...f.entry, questions: [{ ...question, highlights: [highlight] }] });
  const doc = loadDesignDoc(f.path);
  const pack = designDocToPack(doc);
  expect(pack.designDocument?.questions?.[0]).toMatchObject({ highlights: [highlight] });
  for (const invalid of [
    { ...highlight, element: 'missing' },
    { ...highlight, start: { line: 0, column: 1 } },
    { ...highlight, end: { line: 30, column: 1 } },
    { ...highlight, end: { line: 3, column: 90 } },
    { ...highlight, end: highlight.start },
    { ...highlight, start: highlight.end, end: highlight.start },
  ]) {
    f.save({ ...f.entry, questions: [{ ...question, highlights: [invalid] }] });
    expect(() => loadDesignDoc(f.path)).toThrow();
  }
  f.save({ ...f.entry, questions: [{ ...question, highlights: [{ ...highlight, start: { line: 3, column: 9 } }] }] });
  expect(designDocToPack(loadDesignDoc(f.path)).packVersion).not.toBe(pack.packVersion);
  writeFileSync(join(f.root, 'app.yaml'), 'id: app\nname: App\nsummary: Applies edits\nkind: component\n');
  expect(() => loadDesignDoc(f.path)).toThrow(/detail/i);
});

it('validates authored choice lists and preserves their source identity', () => {
  const f = fixture();
  for (const extra of [{ choices: [] }, { choices: ['Yes', 'Yes'] }, { choices: ['Yes', 'Other'] }, { multiple: true }]) {
    f.save({ ...f.entry, questions: [{ ...question, ...extra }] });
    expect(() => loadDesignDoc(f.path)).toThrow();
  }
  f.save({ ...f.entry, questions: [{ ...question, choices: ['Yes', 'No'], multiple: true }] });
  const doc = loadDesignDoc(f.path);
  expect(designDocToPack(doc).designDocument?.questions?.[0]).toMatchObject({ choices: ['Yes', 'No'], multiple: true });
  expect(renderDesignDocMarkdown(doc)).toContain('Answer format: Select all that apply\n    - Yes\n    - No\n    - Other (write in)');
});

it.each([false, true])('validates and retains structured choice answers (multiple=%s)', multiple => {
  const f = fixture();
  f.save({ ...f.entry, questions: [{ ...question, choices: ['Yes', 'No'], multiple }] });
  const lifecycle = f.open();
  const save = (answer: string, choices?: string[]) => lifecycle.answer({ questionId: question.id, answer, ...(choices && { choices }), expected: tuple(lifecycle.status()) });
  for (const choices of [[], ['Unknown'], ['Yes', 'Yes']]) expect(() => save('', choices)).toThrow();
  if (!multiple) {
    expect(() => save('', ['Yes', 'No'])).toThrow();
    expect(() => save('Something else', ['Yes'])).toThrow();
  }
  const choices = multiple ? ['Yes', 'No'] : ['Yes'];
  const before = lifecycle.status();
  const answered = save('', choices);
  expect(() => lifecycle.answer({ questionId: question.id, answer: '', choices, expected: tuple(before) })).toThrow(/stale/i);
  expect(f.open().status().answers).toEqual([{ questionId: question.id, answer: '', choices }]);
  expect(() => lifecycle.reconcile({ ...tuple(answered), decisions: [] })).toThrow(/disposition/i);
  const reconciled = lifecycle.reconcile({ ...tuple(answered), decisions: [disposition] });
  expect(lifecycle.approve({ decision: 'approved', expected: tuple(reconciled) }).approval.valid).toBe(true);
  expect(save('A different approach', multiple ? ['Yes'] : []).approval.valid).toBe(false);
  expect(f.open().status().answers[0]?.answer).toBe('A different approach');
  f.save({ ...f.entry, questions: undefined });
  const historical = f.open(lifecycle.review.reviewPath);
  expect(historical.status().answers).toEqual([]);
  expect(historical.status().approval.reason).toMatch(/reconcil/i);
  const ready = historical.reconcile({ ...tuple(historical.status()), decisions: [disposition] });
  expect(historical.approve({ decision: 'approved', expected: tuple(ready) }).approval.valid).toBe(true);
});

it('rejects choice selections for text questions', () => {
  const lifecycle = fixture().open();
  expect(() => lifecycle.answer({ questionId: question.id, answer: 'Text', choices: ['Yes'], expected: tuple(lifecycle.status()) })).toThrow();
});

it('requires an answer and its reconciliation before exact-input approval', () => {
  const lifecycle = fixture().open();
  const before = lifecycle.status();
  expect(before.approval.reason).toMatch(/unanswered/i);
  expect(() => lifecycle.approve({ decision: 'approved', expected: tuple(before) })).toThrow(/unanswered/i);
  const answered = lifecycle.answer({ questionId: question.id, answer: 'Yes, always refresh the preview.', expected: tuple(before) });
  expect(answered.approval.valid).toBe(false);
  expect(answered.approval.reason).toMatch(/reconcil/i);
  expect(() => lifecycle.reconcile({ ...tuple(answered), decisions: [] })).toThrow(/disposition/i);
  for (const answers of [[1], [0, 0]]) expect(() => lifecycle.reconcile({ ...tuple(answered), decisions: [{ ...disposition, answers }] })).toThrow(/unknown|duplicate/i);
  const reconciled = lifecycle.reconcile({ ...tuple(answered), decisions: [disposition] });
  expect(lifecycle.approve({ decision: 'approved', expected: tuple(reconciled) }).approval.valid).toBe(true);
  expect(() => lifecycle.answer({ questionId: 'missing', answer: 'Yes', expected: tuple(reconciled) })).toThrow(/unknown/i);
});

it('preserves answers across comment writes, restart, and conflicting answer requests', () => {
  const f = fixture();
  const lifecycle = f.open();
  const before = lifecycle.status();
  const comments = lifecycle.review.get();
  const answered = lifecycle.answer({ questionId: question.id, answer: 'Never overwrite my changes.', expected: tuple(before) });
  expect(() => lifecycle.answer({ questionId: question.id, answer: 'Stale page', expected: tuple(before) })).toThrow(/stale/i);
  expect(() => lifecycle.answer({ questionId: question.id, answer: ' ', expected: tuple(answered) })).toThrow();
  lifecycle.review.post({ ...comments, annotations: [{ packVersion: comments.packVersion, target: { type: 'node', id: 'app' }, comment: 'Keep the preview concise.' }] });
  expect(f.open().status().answers).toEqual([{ questionId: question.id, answer: 'Never overwrite my changes.' }]);
  const saved = JSON.parse(readFileSync(lifecycle.review.reviewPath, 'utf8')) as { questions: unknown[] };
  expect(saved.questions).toEqual([question]);
});

it('invalidates approval on changed answers and keeps historical answers as reconciliation obligations', () => {
  const f = fixture();
  const lifecycle = f.open();
  const answered = lifecycle.answer({ questionId: question.id, answer: 'Yes.', expected: tuple(lifecycle.status()) });
  const reconciled = lifecycle.reconcile({ ...tuple(answered), decisions: [disposition] });
  lifecycle.approve({ decision: 'approved', expected: tuple(reconciled) });
  const edited = lifecycle.answer({ questionId: question.id, answer: 'Yes, with a clear diff.', expected: tuple(reconciled) });
  expect(edited.approval.valid).toBe(false);
  expect(edited.approval.reason).toMatch(/reconcil/i);
  const historicalBytes = readFileSync(lifecycle.review.reviewPath, 'utf8');
  f.save({ ...f.entry, summary: 'Always show a fresh preview', questions: undefined });
  expect(() => lifecycle.answer({ questionId: question.id, answer: 'Stale source', expected: tuple(lifecycle.status()) })).toThrow(/source changed/i);
  const current = f.open();
  expect(current.status().approval.reason).toMatch(/reconcil/i);
  expect(current.status().answers).toEqual([]);
  const history = f.open(lifecycle.review.reviewPath);
  const ready = history.reconcile({ ...tuple(history.status()), decisions: [disposition] });
  expect(history.approve({ decision: 'approved', expected: tuple(ready) }).approval.valid).toBe(true);
  expect(readFileSync(lifecycle.review.reviewPath, 'utf8')).toBe(historicalBytes);
});
