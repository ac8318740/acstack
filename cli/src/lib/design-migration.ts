import { constants, closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import type { z } from 'zod';
import { AlignmentPackSchema, ReviewAnnotationSchema, type AlignmentPack, type ReviewAnnotation } from './alignment-packs.js';
import { PACK_DATA_ID } from './alignment-review-protocol.js';
import { designDocToPack, loadDesignDoc } from './design-doc.js';
import { digest } from './design-map.js';
import { LegacyAnnotationSchema, LegacyFeedbackSchema, LegacyMappingSchema, openDesignReview, type StoredDesignReview } from './design-review.js';
import { assertCanonicalProject } from './project-data.js';

// Bound both individual artifacts and the entire import before parsing or publication.
const FILE_LIMIT = 1_000_000;
const HTML_LIMIT = 8_000_000;
const TOTAL_LIMIT = 16_000_000;
function noLinks(path: string): void {
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Legacy import rejects symlinks: ${cursor}`);
    if (dirname(cursor) === cursor) break;
  }
}
function readBounded(path: string, limit: number): string {
  noLinks(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error(`Legacy import file size/type limit: ${path}`);
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit) throw new Error(`Legacy import file too large: ${path}`);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
  } finally { closeSync(fd); }
}
function parseJson<T>(source: string, content: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  try { return schema.parse(JSON.parse(content) as unknown); }
  catch (error) { throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`); }
}
function hasTarget(pack: AlignmentPack, target: ReviewAnnotation['target']): boolean {
  const lists = { node: pack.graph.nodes, group: pack.graph.groups, edge: pack.graph.edges, aggregateEdge: pack.graph.aggregateEdges };
  return lists[target.type].some(item => item.id === target.id);
}
const key = (target: ReviewAnnotation['target']) => `${target.type}:${target.id}`;
function legacyWire(annotation: ReviewAnnotation): ReviewAnnotation {
  const { packVersion, target, selectedText, sourceRef, comment, author, time } = annotation;
  return ReviewAnnotationSchema.parse({ packVersion, target, selectedText, sourceRef, comment, author, time });
}

function legacyComments(annotations: z.infer<typeof LegacyAnnotationSchema>[]) {
  const groups = new Map<string, { annotation: ReviewAnnotation; ids: Set<string>; identifiedAnchors: Set<string>; anonymousAnchors: Set<string> }>();
  for (const annotation of annotations) {
    const wire = legacyWire(annotation);
    const fingerprint = digest(wire);
    const group = groups.get(fingerprint) ?? { annotation: wire, ids: new Set<string>(), identifiedAnchors: new Set<string>(), anonymousAnchors: new Set<string>() };
    if (annotation.id) {
      group.ids.add(annotation.id);
      if (annotation.quoteAnchor) group.identifiedAnchors.add(digest(annotation.quoteAnchor));
    } else if (annotation.quoteAnchor) group.anonymousAnchors.add(digest(annotation.quoteAnchor));
    groups.set(fingerprint, group);
  }
  return new Map([...groups].map(([identity, group]) => [identity, {
    annotation: group.annotation,
    count: Math.max(1, group.ids.size + [...group.anonymousAnchors].filter(anchor => !group.identifiedAnchors.has(anchor)).length),
  }]));
}

// Resolve the same Git common directory used by skills/implement/decision-log.md, without requiring git on the caller's PATH.
function mainCheckout(root: string): string {
  let git = join(root, '.git');
  noLinks(git);
  if (!lstatSync(git).isDirectory()) {
    const pointer = readBounded(git, 4096).trim().match(/^gitdir: (.+)$/);
    if (!pointer) throw new Error('Invalid legacy decision-log Git directory');
    git = resolve(root, pointer[1]);
    noLinks(git);
  }
  if (lstatSync(join(git, 'commondir'), { throwIfNoEntry: false })) git = resolve(git, readBounded(join(git, 'commondir'), 4096).trim());
  noLinks(git);
  return dirname(git);
}

export function migrateDesignReview(root: string, entry: string, options: { legacyDir: string; mapping: string; feedback?: string }): { reviewPath: string } {
  const pack = designDocToPack(loadDesignDoc(entry));
  const directory = resolve(options.legacyDir);
  const base = join(root, '.acstack', 'alignment-packs');
  const rel = relative(base, directory);
  if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Legacy directory must be under .acstack/alignment-packs');
  noLinks(directory);
  if (!lstatSync(directory).isDirectory()) throw new Error('Invalid legacy directory');
  const sources: { path: string; digest: string; content?: string }[] = [];
  let total = 0;
  const read = (path: string, limit = FILE_LIMIT): string => {
    const content = readBounded(path, limit);
    total += Buffer.byteLength(content);
    if (total > TOTAL_LIMIT) throw new Error('Legacy import total size limit exceeded');
    sources.push({ path: relative(root, path).split('\\').join('/'), digest: digest(content) });
    return content;
  };
  const mapping = parseJson(`Legacy mapping ${options.mapping}`, read(resolve(options.mapping)), LegacyMappingSchema);
  const names: string[] = [];
  const listing = opendirSync(directory);
  try {
    for (let item = listing.readSync(); item; item = listing.readSync()) {
      if (names.length >= 128) throw new Error('Legacy directory artifact limit exceeded');
      if (!item.isFile()) throw new Error('Legacy directory artifacts must be nonsymlink regular files');
      names.push(item.name);
    }
  } finally { listing.closeSync(); }
  const versions = new Map<string, AlignmentPack>();
  let annotationsJsonl = '';
  for (const name of names.sort()) {
    const path = join(directory, name);
    const content = read(path, name.endsWith('.html') ? HTML_LIMIT : FILE_LIMIT);
    if (!name.endsWith('.html')) {
      sources[sources.length - 1].content = content;
      if (name === 'annotations.jsonl') annotationsJsonl = content;
      continue;
    }
    const scripts = [...content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(match => new RegExp(`\\bid=["']${PACK_DATA_ID}["']`).test(match[1]));
    if (scripts.length !== 1 || scripts[0][1].trim() !== `id="${PACK_DATA_ID}" type="application/json"`) throw new Error(`Invalid legacy pack JSON metadata: ${name}`);
    const saved = parseJson(`Legacy pack ${path}`, scripts[0][2], AlignmentPackSchema);
    if (saved.source.map.id !== basename(directory) || saved.packVersion !== `${saved.source.map.id}@${saved.source.map.version}`) throw new Error('Legacy pack directory identity mismatch');
    if (saved.reviewState.approval && saved.reviewState.approval.packVersion !== saved.packVersion) throw new Error('Legacy pack approval version mismatch');
    const previous = versions.get(saved.packVersion);
    if (previous && digest(previous) !== digest(saved)) throw new Error('Conflicting duplicate legacy pack version');
    versions.set(saved.packVersion, saved);
  }
  if (!versions.size) throw new Error('Legacy directory contains no pack HTML');
  const annotations = annotationsJsonl.split(/\r?\n/).flatMap((line, index) => line.trim()
    ? [parseJson(`Legacy annotation ${join(directory, 'annotations.jsonl')}:${index + 1}`, line, LegacyAnnotationSchema)] : []);
  const feedback = options.feedback ? parseJson(`Legacy feedback ${options.feedback}`, read(resolve(options.feedback)), LegacyFeedbackSchema) : undefined;
  if (feedback) {
    if (!versions.has(feedback.packVersion) || feedback.reviewState.approval && feedback.reviewState.approval.packVersion !== feedback.packVersion || feedback.annotations.some(annotation => annotation.packVersion !== feedback.packVersion)) throw new Error('Feedback pack version mismatch');
    annotations.push(...feedback.annotations);
  }
  const mappings = new Map<string, ReviewAnnotation['target']>();
  for (const pair of mapping) {
    if (!hasTarget(pack, pair.to) || ![...versions.values()].some(saved => hasTarget(saved, pair.from))) throw new Error('Unknown mapping target or wrong target type');
    const previous = mappings.get(key(pair.from));
    if (previous && key(previous) !== key(pair.to)) throw new Error('Conflicting legacy mapping');
    mappings.set(key(pair.from), pair.to);
  }
  const ids = new Map<string, string>();
  for (const annotation of annotations) {
    const saved = versions.get(annotation.packVersion);
    if (!saved || !hasTarget(saved, annotation.target)) throw new Error('Unknown legacy annotation pack or target');
    if (!mappings.has(key(annotation.target))) throw new Error('Missing mapping for legacy annotation target');
    const fingerprint = digest(annotation);
    if (annotation.id) {
      const identity = `${annotation.packVersion}:${annotation.id}`;
      if (ids.has(identity) && ids.get(identity) !== fingerprint) throw new Error('Conflicting duplicate legacy annotation');
      ids.set(identity, fingerprint);
    }
  }
  const main = mainCheckout(root);
  assertCanonicalProject(main);
  const decisionPath = join(main, '.acstack', 'decision-logs', `${basename(directory)}.tsv`);
  for (const path of [join(main, '.acstack'), dirname(decisionPath), decisionPath]) {
    if (lstatSync(path, { throwIfNoEntry: false })) noLinks(path);
  }
  const decisionLog = lstatSync(decisionPath, { throwIfNoEntry: false }) ? { path: `.acstack/decision-logs/${basename(directory)}.tsv`, content: readBounded(decisionPath, FILE_LIMIT) } : undefined;
  const history = { directory: relative(root, directory).split('\\').join('/'), sources: sources.sort((a, b) => a.path.localeCompare(b.path)), packs: [...versions.values()], annotations, mapping, feedback, decisionLog };
  const fingerprint = digest(history);
  const apply = (snapshot: StoredDesignReview) => {
    if (snapshot.imports?.some(receipt => receipt.fingerprint === fingerprint)) return;
    const imported = snapshot.imports?.flatMap(receipt => receipt.history.annotations) ?? [];
    const previous = legacyComments(imported);
    for (const [identity, group] of legacyComments([...imported, ...annotations])) {
      // Bare exports alias an identified group; receipt counts survive deletion from the current review.
      const before = previous.get(identity);
      const added = group.count - (before?.count ?? 0);
      for (let index = 0; index < added; index++) {
        snapshot.annotations.push(ReviewAnnotationSchema.parse({ ...group.annotation, packVersion: pack.packVersion, target: mappings.get(key(group.annotation.target)) }));
      }
    }
    snapshot.imports = [...(snapshot.imports ?? []), { fingerprint, history }];
    snapshot.revision += 1;
  };
  // Size-check even a first import before creating canonical directories or acquiring the writer lock.
  const preview: StoredDesignReview = { packVersion: pack.packVersion, revision: 0, annotations: [] };
  apply(preview);
  if (Buffer.byteLength(JSON.stringify(preview)) > FILE_LIMIT) throw new Error('Legacy import review too large');
  return { reviewPath: openDesignReview(root, pack, apply).reviewPath };
}
