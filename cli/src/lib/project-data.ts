import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { replaceFileAtomically } from './atomic-file.js';
import { hasLegacyProjectData } from './project.js';
import { ACSTACK_DIR, LEGACY_ACSTACK_DIR, DECISIONS_DIR, DECISION_LOGS_DIR, VERIFICATION_DIR } from './constants.js';

const BEGIN = '# >>> acstack project-data >>>';
const END = '# <<< acstack project-data <<<';
const KNOWLEDGE = 'VERIFICATION-KNOWLEDGE.md';

function present(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export function assertCanonicalProject(root: string): void {
  if (!existsSync(join(root, ACSTACK_DIR)) && hasLegacyProjectData(root)) {
    throw new Error('Legacy ACStack project data found. Stop review servers and agents, back up the project, then run `acstack project-data migrate` from the project root.');
  }
}

function gitignorePlan(root: string): { path: string; before: string; after: string; mode?: number } {
  const path = join(root, '.gitignore');
  const stat = present(path) ? lstatSync(path) : undefined;
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`${path}: .gitignore must be a regular file, not a symlink`);
  let before = '';
  if (stat) {
    try { before = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path)); }
    catch (error) {
      if (error instanceof TypeError) throw new Error(`${path}: invalid UTF-8; refusing to rewrite .gitignore`);
      throw error;
    }
  }
  const bom = before.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = before.slice(bom.length);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const markers = lines.flatMap((line, index) => {
    const text = line.replace(/\r?\n$/, '');
    return text.includes('acstack project-data') && (text.includes('>>>') || text.includes('<<<')) ? [{ text, index }] : [];
  });
  if (markers.length !== 0 && (markers.length !== 2 || markers[0].text !== BEGIN || markers[1].text !== END)) {
    throw new Error(`${path}: malformed ACStack project-data managed markers`);
  }
  const outside = markers.length === 0 ? body : lines.filter((_, i) => i < markers[0].index || i > markers[1].index).join('');
  const baseline = [BEGIN, `!/${ACSTACK_DIR}/`, `/${ACSTACK_DIR}/**`, END, ''].join(eol);
  return { path, before, after: bom + baseline + outside, mode: stat?.mode };
}

/** Reconcile the root policy without creating project data or changing Git's index. */
export function ensureProjectGitignore(root: string): void {
  if (!present(join(root, ACSTACK_DIR))) return;
  const plan = gitignorePlan(root);
  if (plan.before === plan.after) return;
  replaceFileAtomically(plan.path, plan.after, plan.mode === undefined ? undefined : temp => chmodSync(temp, plan.mode!));
}

interface Move { from: string; to: string }
interface LinkChange { path: string; before: string; after: string }

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
}

/** Explicit offline migration: stop agents and review servers and take a backup first. */
export function migrateProjectData(root: string): { moved: string[] } {
  root = resolve(root);
  const legacy = join(root, LEGACY_ACSTACK_DIR);
  const canonical = join(root, ACSTACK_DIR);
  if (present(legacy) && (!lstatSync(legacy).isDirectory() || lstatSync(legacy).isSymbolicLink())) throw new Error(`${legacy}: legacy project data must be a real directory`);
  const candidates: Move[] = [
    ...(hasLegacyProjectData(root) ? [{ from: legacy, to: canonical }] : []),
    { from: join(root, 'docs', 'adr'), to: join(canonical, DECISIONS_DIR) },
    { from: join(root, 'CONTEXT.md'), to: join(canonical, 'CONTEXT.md') },
    { from: join(root, 'agent-browser.json'), to: join(canonical, 'agent-browser.json') },
    { from: join(root, '.test-baseline'), to: join(canonical, '.test-baseline') },
    { from: join(root, '.decisions'), to: join(canonical, DECISION_LOGS_DIR) },
    { from: join(root, KNOWLEDGE), to: join(canonical, VERIFICATION_DIR, KNOWLEDGE) },
  ];
  // Only the named internal knowledge file belongs to ACStack, never its helpers directory.
  const config = join(legacy, 'project.yaml');
  if (hasLegacyProjectData(root) && existsSync(config)) {
    const yaml = parse(readFileSync(config, 'utf8')) as { frontend?: { helpers_dir?: unknown } } | null;
    const helpers = yaml?.frontend?.helpers_dir;
    if (typeof helpers === 'string') {
      const path = resolve(root, helpers, KNOWLEDGE);
      if (inside(root, path) && present(path) && inside(realpathSync(root), realpathSync(dirname(path)))) {
        if (!candidates.some(move => move.from === path)) candidates.push({ from: path, to: join(canonical, VERIFICATION_DIR, KNOWLEDGE) });
      }
    }
  }
  const moves = candidates.filter(move => present(move.from));
  if (moves.length === 0) { ensureProjectGitignore(root); return { moved: [] }; }
  if (present(canonical)) throw new Error(`${canonical}: migration destination already exists; refusing to merge or overwrite project data`);
  const ignore = gitignorePlan(root);
  const mapPath = (path: string): string => {
    const move = [...moves].sort((a, b) => b.from.length - a.from.length).find(candidate => inside(candidate.from, path));
    return move ? join(move.to, relative(move.from, path)) : path;
  };
  for (const move of moves) {
    // Refuse symlinked source parents rather than traversing another directory.
    for (let parent = dirname(move.from); parent !== root; parent = dirname(parent)) {
      if (!inside(root, parent) || lstatSync(parent).isSymbolicLink()) throw new Error(`${parent}: migration cannot traverse a symlinked source directory`);
    }
    for (const other of moves) {
      if (move === other) continue;
      if (move.to === other.to) throw new Error(`${move.to}: conflicting incoming project data`);
      if (inside(other.to, move.to)) {
        const incoming = join(other.from, relative(other.to, move.to));
        if (present(incoming)) throw new Error(`${move.to}: destination conflicts with incoming legacy data`);
        for (let parent = dirname(incoming); parent !== other.from; parent = dirname(parent)) {
          if (present(parent) && (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink())) throw new Error(`${parent}: unsafe incoming destination parent`);
        }
      }
    }
  }
  const links: LinkChange[] = [];
  const removals: { path: string; text: string; mode: number }[] = [];
  const ownedIgnores = new Set([
    join(legacy, 'alignment-packs', '.gitignore'), join(legacy, 'design-reviews', '.gitignore'),
    join(root, '.decisions', '.gitignore'), join(legacy, DECISION_LOGS_DIR, '.gitignore'),
  ]);
  const visited = new Set<string>();
  const inspect = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const before = readlinkSync(path);
      const target = mapPath(resolve(dirname(path), before));
      const after = isAbsolute(before) ? target : relative(dirname(mapPath(path)), target) || '.';
      if (before !== after) links.push({ path: mapPath(path), before, after });
    } else if (stat.isDirectory()) {
      for (const name of readdirSync(path)) inspect(join(path, name));
    } else if (ownedIgnores.has(path) && stat.isFile()) {
      const text = readFileSync(path, 'utf8');
      const normalized = text.replace(/\r\n/g, '\n');
      if (normalized === '*\n' || normalized === '*' || normalized === '# Written by acstack. Delete this file and set workflow.alignment_packs.commit_generated_packs: true to commit packs.\n*\n') {
        removals.push({ path: mapPath(path), text, mode: stat.mode });
      }
    }
  };
  for (const move of moves) inspect(move.from);
  const undo: (() => void)[] = [];
  const makeParents = (path: string) => {
    if (present(path)) return;
    makeParents(dirname(path));
    mkdirSync(path);
    undo.push(() => rmdirSync(path));
  };
  try {
    for (const move of moves) {
      // A knowledge file may already have moved inside the legacy tree.
      const from = present(move.from) ? move.from : join(canonical, relative(legacy, move.from));
      makeParents(dirname(move.to));
      if (present(move.to)) throw new Error(`${move.to}: migration destination appeared during migration`);
      renameSync(from, move.to);
      undo.push(() => renameSync(move.to, from));
    }
    for (const link of links) {
      unlinkSync(link.path);
      try { symlinkSync(link.after, link.path); }
      catch (error) { symlinkSync(link.before, link.path); throw error; }
      undo.push(() => { unlinkSync(link.path); symlinkSync(link.before, link.path); });
    }
    for (const removal of removals) {
      unlinkSync(removal.path);
      undo.push(() => replaceFileAtomically(removal.path, removal.text, temp => chmodSync(temp, removal.mode)));
    }
    replaceFileAtomically(ignore.path, ignore.after, ignore.mode === undefined ? undefined : temp => chmodSync(temp, ignore.mode!));
    return { moved: moves.map(move => relative(root, move.to)) };
  } catch (error) {
    const failures: string[] = [];
    for (const rollback of undo.reverse()) {
      try { rollback(); } catch (failure) { failures.push(String(failure)); }
    }
    if (failures.length) throw new Error(`${String(error)}; rollback incomplete: ${failures.join('; ')}`);
    throw error;
  }
}
