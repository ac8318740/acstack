import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { z } from 'zod';
import { type AlignmentPack, type MapQuestion, ReviewAnnotationSchema } from './alignment-packs.js';
import { ReviewHttpError } from './review-server.js';

export const DesignReviewSnapshotSchema = z.object({
  packVersion: z.string().min(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  annotations: z.array(ReviewAnnotationSchema),
}).strict();
export type DesignReviewSnapshot = z.infer<typeof DesignReviewSnapshotSchema>;

// What the page showed when an element locked, such as a mock's chosen variant and tweaks. The page owns its shape.
export const LockCaptureSchema = z.record(z.unknown());
export const ApprovedElementSchema = z.object({
  title: z.string().optional(), name: z.string(), summary: z.string(), detail: z.string().optional(), kind: z.string(), parent: z.string().optional(), channels: z.array(z.string()),
  connections: z.array(z.object({ to: z.string(), direction: z.string(), label: z.string() }).strict()),
  mocks: z.record(z.string()),
}).strict();
export type ApprovedElement = z.infer<typeof ApprovedElementSchema>;
const RevisionTupleSchema = z.object({
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/), reviewRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  commentsDigest: z.string().regex(/^[a-f0-9]{64}$/), mapInputsDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export { RevisionTupleSchema };
export const ReconciliationSchema = RevisionTupleSchema.extend({
  decisions: z.array(z.object({ comments: z.array(z.number().int().nonnegative()),
    outcome: z.enum(['applied', 'retained', 'needs-human']), rationale: z.string().trim().min(1).max(16000),
  }).strict()),
}).strict();
export const VariantChoiceSchema = z.object({
  variant: z.string().min(1).max(1024), tweaks: z.record(z.string().max(1024)).default({}), states: z.record(z.array(z.string().max(1024))).default({}), chosenAt: z.string(),
}).strict();
const EvidenceSchema = z.object({
  reconciliations: z.array(ReconciliationSchema.extend({ reviewPath: z.string(), feedbackPackVersion: z.string(), scopeCommentsDigest: z.string().regex(/^[a-f0-9]{64}$/), recordedAt: z.string() }).strict()).default([]),
  approvals: z.array(RevisionTupleSchema.extend({ recordedAt: z.string() }).strict()).default([]),
  // Element id to the config digest the user locked, so a later config edit can be flagged, and what the page showed then.
  // `approved` keeps the element as it was approved, so a later edit can say what changed.
  locks: z.record(z.object({ config: z.string().regex(/^[a-f0-9]{64}$/), capture: LockCaptureSchema.optional(), approved: ApprovedElementSchema.optional(), approvedAt: z.string().optional() }).strict()).default({}),
  // Element id to mock path to the variant the user chose for a mock with several, and its tweak values then.
  choices: z.record(z.record(VariantChoiceSchema)).default({}),
}).strict();
export const DesignAnswerSchema = z.object({
  questionId: z.string().min(1).max(80), answer: z.string().trim().max(16000),
  choices: z.array(z.string().max(500)).max(12).optional(),
}).strict();
export type DesignAnswer = z.infer<typeof DesignAnswerSchema>;

export function validateDesignAnswer(question: MapQuestion, answer: DesignAnswer): void {
  if (!question.choices) {
    if (answer.choices !== undefined || !answer.answer) throw new Error('Text questions require a nonempty text answer without choices');
    return;
  }
  const selected = answer.choices ?? [];
  if (new Set(selected).size !== selected.length || selected.some(choice => !question.choices?.includes(choice))) throw new Error('Unknown or duplicate answer choice');
  const count = selected.length + Number(Boolean(answer.answer));
  if (count === 0 || (!question.multiple && count !== 1)) throw new Error('Select an answer or write Other; single-choice questions allow only one response');
}
const StoredReviewSchema = DesignReviewSnapshotSchema.extend({
  lifecycle: EvidenceSchema.optional(),
  // Reviews of earlier revisions whose comments carry forward, each with the change that ended it.
  carried: z.array(z.object({ reviewPath: z.string().min(1), label: z.string().min(1).max(500) }).strict()).max(1000).optional(),
}).strict();
export type StoredDesignReview = z.infer<typeof StoredReviewSchema>;

// A review file that fails validation is never rewritten; each read and write names it until someone fixes it.
function reviewFileError(path: string, error: unknown): ReviewHttpError {
  const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
  const problem = issue ? `${issue.path.join('.')}: ${issue.message}` : error instanceof Error ? error.message : String(error);
  return Object.assign(new ReviewHttpError(409, `Cannot read review file ${path}: ${problem}. Fix or remove the file; the review stays read-only until then.`), { cause: error });
}

export function readDesignReviewHistory(root: string, identity: string, path: string): StoredDesignReview {
  const canonical = resolve(path);
  const base = join(root, 'design-reviews', identity);
  if (basename(canonical) !== 'review.json' || !/^[a-f0-9]{16}$/.test(basename(dirname(canonical))) || dirname(dirname(canonical)) !== base) throw new Error('Not canonical history for this design');
  for (const directory of [root, join(root, 'design-reviews'), base, dirname(canonical)]) {
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error('Invalid review history directory');
  }
  const stat = lstatSync(canonical);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Invalid review history file');
  let snapshot: StoredDesignReview;
  try {
    snapshot = StoredReviewSchema.parse(JSON.parse(readFileSync(canonical, 'utf8')) as unknown);
  } catch (error) { throw reviewFileError(canonical, error); }
  if (snapshot.packVersion !== `${identity}@${basename(dirname(canonical))}` || snapshot.annotations.some(annotation => annotation.packVersion !== snapshot.packVersion)) throw new Error('Review history identity mismatch');
  return snapshot;
}

export function readDesignReviewHistories(root: string, identity: string): Map<string, StoredDesignReview> {
  const base = join(root, 'design-reviews', identity);
  const histories = new Map<string, StoredDesignReview>();
  // Bound discovery even when unrelated directory entries or large histories accumulate.
  const directory = opendirSync(base);
  let entries = 0;
  let bytes = 0;
  try {
    for (let item = directory.readSync(); item; item = directory.readSync()) {
      if (++entries > 1024) throw new Error('Canonical review history exceeds the 1024-entry discovery limit');
      if (!/^[a-f0-9]{16}$/.test(item.name)) continue;
      const path = join(base, item.name, 'review.json');
      bytes += lstatSync(path).size;
      if (bytes > 16 * 1024 * 1024) throw new Error('Canonical review history exceeds the 16 MiB discovery limit');
      histories.set(path, readDesignReviewHistory(root, identity, path));
    }
  } finally { directory.closeSync(); }
  return histories;
}

function atomicWrite(path: string, text: string): void {
  const temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`;
  let created = false;
  try {
    // Flush the bytes before the rename and the rename itself, so a power loss never leaves an empty review.
    const file = openSync(temporary, 'wx', 0o600);
    created = true;
    try { writeFileSync(file, text); fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, path);
    try {
      const directory = openSync(dirname(path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch { /* Some platforms, such as Windows, cannot fsync a directory; the file itself is already durable. */ }
  } finally { if (created) rmSync(temporary, { force: true }); }
}

export function openDesignReview(root: string, pack: AlignmentPack): {
  reviewPath: string;
  get: () => DesignReviewSnapshot;
  transact: <T>(operation: (snapshot: StoredDesignReview) => T) => T;
  post: (body: unknown) => DesignReviewSnapshot;
} {
  const identity = pack.designDocument?.id;
  const version = pack.source.map.version;
  if (!identity || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(identity) || !/^[a-f0-9]{16}$/.test(version)) throw new Error('Invalid design review identity');
  let directory = root;
  for (const part of ['design-reviews', identity, version]) {
    directory = join(directory, part);
    if (!existsSync(directory)) mkdirSync(directory);
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error('Design review directory must be a real directory');
  }
  const canonical = join(directory, 'review.json');
  const validate = (snapshot: DesignReviewSnapshot) => {
    if (snapshot.packVersion !== pack.packVersion) throw new Error('Design review pack version mismatch');
    const lists = { node: pack.graph.nodes, group: pack.graph.groups, edge: pack.graph.edges, aggregateEdge: pack.graph.aggregateEdges };
    for (const annotation of snapshot.annotations) {
      if (annotation.packVersion !== pack.packVersion) throw new Error('Comment pack version mismatch');
      if (!lists[annotation.target.type].some(target => target.id === annotation.target.id)) throw new Error(`Unknown annotation target: ${annotation.target.id}`);
    }
  };
  const lock = join(directory, '.writer-lock');
  const acquire = () => {
    try { mkdirSync(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ReviewHttpError(409, `Another writer holds ${lock}. If a writer crashed, remove that directory before retrying.`);
      throw error;
    }
  };
  const release = () => { rmSync(lock, { recursive: true }); };
  const readSnapshot = (): StoredDesignReview => {
    try {
      const stat = lstatSync(canonical);
      if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Invalid review file');
      const saved = StoredReviewSchema.parse(JSON.parse(readFileSync(canonical, 'utf8')) as unknown);
      validate(saved);
      return saved;
    } catch (error) { throw reviewFileError(canonical, error); }
  };
  let snapshot: StoredDesignReview = { packVersion: pack.packVersion, revision: 0, annotations: [] };
  acquire();
  try {
    const exists = Boolean(lstatSync(canonical, { throwIfNoEntry: false }));
    // An unreadable file still opens, read-only: every later read and write re-reads it and reports the problem.
    let readable = true;
    if (exists) try { snapshot = readSnapshot(); } catch { readable = false; }
    if (readable) {
      const before = exists ? JSON.stringify(snapshot) : undefined;
      validate(snapshot);
      const serialized = JSON.stringify(StoredReviewSchema.parse(snapshot));
      if (Buffer.byteLength(serialized) > 1_000_000) throw new Error('Review too large');
      if (serialized !== before) atomicWrite(canonical, serialized);
    }
  } finally { release(); }
  return {
    reviewPath: canonical,
    transact: operation => {
      acquire();
      try {
        const saved = readSnapshot();
        const before = JSON.stringify(saved);
        const result = operation(saved);
        const next = JSON.stringify(StoredReviewSchema.parse(saved));
        if (Buffer.byteLength(next) > 1_000_000) throw new Error('Review too large');
        if (next !== before) atomicWrite(canonical, next);
        return result;
      } finally { release(); }
    },
    get: () => {
      acquire();
      try {
        snapshot = readSnapshot();
        return DesignReviewSnapshotSchema.parse({ packVersion: snapshot.packVersion, revision: snapshot.revision, annotations: snapshot.annotations });
      } finally { release(); }
    },
    post: body => {
      const incoming = DesignReviewSnapshotSchema.parse(body);
      validate(incoming);
      acquire();
      try {
        snapshot = readSnapshot();
        if (incoming.revision !== snapshot.revision) {
          if (incoming.revision === snapshot.revision - 1 && JSON.stringify(incoming.annotations) === JSON.stringify(snapshot.annotations)) {
            return DesignReviewSnapshotSchema.parse({ packVersion: snapshot.packVersion, revision: snapshot.revision, annotations: snapshot.annotations });
          }
          throw new ReviewHttpError(409, 'Review changed in another page. Your local comments are preserved; reload to reconcile.');
        }
        const next = { ...snapshot, ...incoming, revision: snapshot.revision + 1 };
        const serialized = JSON.stringify(next);
        if (Buffer.byteLength(serialized) > 1_000_000) throw new Error('Review too large');
        atomicWrite(canonical, serialized);
        snapshot = next;
        return DesignReviewSnapshotSchema.parse({ packVersion: snapshot.packVersion, revision: snapshot.revision, annotations: snapshot.annotations });
      } finally { release(); }
    },
  };
}
