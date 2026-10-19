import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type AlignmentPack, ReviewAnnotationSchema } from './alignment-packs.js';
import { ACSTACK_DIR } from './constants.js';
import { ensureProjectGitignore } from './project-data.js';
import { ReviewHttpError } from './review-server.js';

export const DesignReviewSnapshotSchema = z.object({
  packVersion: z.string().min(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  annotations: z.array(ReviewAnnotationSchema),
}).strict();
export type DesignReviewSnapshot = z.infer<typeof DesignReviewSnapshotSchema>;

function atomicWrite(path: string, text: string): void {
  const temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`;
  let created = false;
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    created = true;
    renameSync(temporary, path);
  } finally { if (created) rmSync(temporary, { force: true }); }
}

export function openDesignReview(root: string, pack: AlignmentPack): {
  reviewPath: string;
  get: () => DesignReviewSnapshot;
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
  ensureProjectGitignore(root);
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
  const readSnapshot = (): DesignReviewSnapshot => {
    try {
      const saved = DesignReviewSnapshotSchema.parse(JSON.parse(readFileSync(canonical, 'utf8')) as unknown);
      validate(saved);
      return saved;
    } catch (error) { throw new Error(`Cannot read canonical design review: ${error instanceof Error ? error.message : String(error)}`); }
  };
  let snapshot: DesignReviewSnapshot = { packVersion: pack.packVersion, revision: 0, annotations: [] };
  acquire();
  try {
    if (existsSync(canonical)) snapshot = readSnapshot();
    else atomicWrite(canonical, JSON.stringify(snapshot));
  } finally { release(); }
  return {
    reviewPath: canonical,
    get: () => {
      acquire();
      try {
        snapshot = readSnapshot();
        return snapshot;
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
            return snapshot;
          }
          throw new ReviewHttpError(409, 'Review changed in another page. Your local comments are preserved; reload to reconcile.');
        }
        const next = { ...incoming, revision: snapshot.revision + 1 };
        atomicWrite(canonical, JSON.stringify(next));
        snapshot = next;
        return snapshot;
      } finally { release(); }
    },
  };
}
