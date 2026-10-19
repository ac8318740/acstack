import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, opendirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { z } from 'zod';
import { type AlignmentPack, AlignmentPackSchema, ReviewAnnotationSchema, ReviewStateSchema } from './alignment-packs.js';
import { ACSTACK_DIR } from './constants.js';
import { ensureProjectGitignore } from './project-data.js';
import { ReviewHttpError } from './review-server.js';

export const DesignReviewSnapshotSchema = z.object({
  packVersion: z.string().min(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  annotations: z.array(ReviewAnnotationSchema),
}).strict();
export type DesignReviewSnapshot = z.infer<typeof DesignReviewSnapshotSchema>;

const RevisionTupleSchema = z.object({
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/), reviewRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  commentsDigest: z.string().regex(/^[a-f0-9]{64}$/), mapInputsDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export { RevisionTupleSchema };
export const ReconciliationSchema = RevisionTupleSchema.extend({
  decisions: z.array(z.object({ comments: z.array(z.number().int().nonnegative()), contributions: z.array(z.string()),
    outcome: z.enum(['applied', 'retained', 'needs-human']), rationale: z.string().trim().min(1).max(16000),
  }).strict()),
}).strict();
const EvidenceSchema = z.object({
  reconciliations: z.array(ReconciliationSchema.extend({ reviewPath: z.string(), feedbackPackVersion: z.string(), scopeCommentsDigest: z.string().regex(/^[a-f0-9]{64}$/), recordedAt: z.string() }).strict()).default([]),
  approvals: z.array(RevisionTupleSchema.extend({ recordedAt: z.string() }).strict()).default([]),
}).strict();
export const LegacyAnnotationSchema = ReviewAnnotationSchema.extend({
  id: z.string().min(1).optional(),
  quoteAnchor: z.object({ prefix: z.string().max(32), suffix: z.string().max(32) }).strict().nullable().optional(),
}).strict();
export const LegacyMappingSchema = z.array(z.object({ from: ReviewAnnotationSchema.shape.target, to: ReviewAnnotationSchema.shape.target }).strict()).max(10000);
export const LegacyFeedbackSchema = z.object({ packVersion: z.string().min(1), reviewState: ReviewStateSchema, annotations: z.array(LegacyAnnotationSchema).max(10000).default([]) }).strict();
const ImportSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  history: z.object({
    directory: z.string(), sources: z.array(z.object({ path: z.string(), digest: z.string(), content: z.string().optional() }).strict()),
    packs: z.array(AlignmentPackSchema), annotations: z.array(LegacyAnnotationSchema), mapping: LegacyMappingSchema,
    feedback: LegacyFeedbackSchema.optional(), decisionLog: z.object({ path: z.string(), content: z.string() }).strict().optional(),
  }).strict(),
}).strict();
const StoredReviewSchema = DesignReviewSnapshotSchema.extend({ lifecycle: EvidenceSchema.optional(), imports: z.array(ImportSchema).optional() }).strict();
export type StoredDesignReview = z.infer<typeof StoredReviewSchema>;

export function readDesignReviewHistory(root: string, identity: string, path: string): StoredDesignReview {
  const canonical = resolve(path);
  const base = join(root, ACSTACK_DIR, 'design-reviews', identity);
  if (basename(canonical) !== 'review.json' || !/^[a-f0-9]{16}$/.test(basename(dirname(canonical))) || dirname(dirname(canonical)) !== base) throw new Error('Not canonical history for this design');
  for (const directory of [join(root, ACSTACK_DIR), join(root, ACSTACK_DIR, 'design-reviews'), base, dirname(canonical)]) {
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error('Invalid review history directory');
  }
  const stat = lstatSync(canonical);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Invalid review history file');
  let snapshot: StoredDesignReview;
  try {
    snapshot = StoredReviewSchema.parse(JSON.parse(readFileSync(canonical, 'utf8')) as unknown);
  } catch (error) {
    throw new Error(`Cannot read design review history ${canonical}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (snapshot.packVersion !== `${identity}@${basename(dirname(canonical))}` || snapshot.annotations.some(annotation => annotation.packVersion !== snapshot.packVersion)) throw new Error('Review history identity mismatch');
  return snapshot;
}

export function readDesignReviewHistories(root: string, identity: string): Map<string, StoredDesignReview> {
  const base = join(root, ACSTACK_DIR, 'design-reviews', identity);
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
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    created = true;
    renameSync(temporary, path);
  } finally { if (created) rmSync(temporary, { force: true }); }
}

export function openDesignReview(root: string, pack: AlignmentPack, initialOperation?: (snapshot: StoredDesignReview) => void): {
  reviewPath: string;
  get: () => DesignReviewSnapshot;
  transact: <T>(operation: (snapshot: StoredDesignReview) => T) => T;
  post: (body: unknown) => DesignReviewSnapshot;
} {
  const identity = pack.designDocument?.id;
  const version = pack.source.map.version;
  if (!identity || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(identity) || !/^[a-f0-9]{16}$/.test(version)) throw new Error('Invalid design review identity');
  let directory = root;
  for (const part of [ACSTACK_DIR, 'design-reviews', identity, version]) {
    directory = join(directory, part);
    if (!existsSync(directory)) mkdirSync(directory);
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error('Design review directory must be a real directory');
  }
  if (!initialOperation) ensureProjectGitignore(root);
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
    } catch (error) { throw new Error(`Cannot read canonical design review: ${error instanceof Error ? error.message : String(error)}`); }
  };
  let snapshot: StoredDesignReview = { packVersion: pack.packVersion, revision: 0, annotations: [] };
  acquire();
  try {
    if (lstatSync(canonical, { throwIfNoEntry: false })) snapshot = readSnapshot();
    const before = lstatSync(canonical, { throwIfNoEntry: false }) ? JSON.stringify(snapshot) : undefined;
    initialOperation?.(snapshot);
    validate(snapshot);
    const serialized = JSON.stringify(StoredReviewSchema.parse(snapshot));
    if (Buffer.byteLength(serialized) > 1_000_000) throw new Error('Review too large');
    if (serialized !== before) atomicWrite(canonical, serialized);
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
