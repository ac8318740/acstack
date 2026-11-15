import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { replaceFileAtomically } from './atomic-file.js';
import { checkoutRoot, findOrphans, hasLegacyData, hasLegacyProjectData, legacyParts, locateProject, recordProject, REPO_RECORDS, type ProjectLocation } from './project.js';
import { ACSTACK_DIR, ACSTACK_HOME, LEGACY_ACSTACK_DIR, DECISIONS_DIR, DECISION_LOGS_DIR, VERIFICATION_DIR, PROJECT_JSON_FILE, SPECS_DIR, DOMAIN_MAP_FILE } from './constants.js';

const BEGIN = '# >>> acstack project-data >>>';
const END = '# <<< acstack project-data <<<';
const KNOWLEDGE = 'VERIFICATION-KNOWLEDGE.md';

function present(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Remove the managed block older releases kept in the root .gitignore; project data no longer lives in the repo by default. */
export function removeManagedGitignoreBlock(root: string): void {
  const path = join(root, '.gitignore');
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) return;
  const before = readFileSync(path, 'utf8');
  const lines = before.split(/(?<=\n)/);
  const begin = lines.findIndex(line => line.trimEnd() === BEGIN);
  const end = lines.findIndex(line => line.trimEnd() === END);
  if (begin === -1 || end < begin) return;
  const after = [...lines.slice(0, begin), ...lines.slice(end + 1)].join('').replace(/^(\r?\n)+/, '');
  replaceFileAtomically(path, after, temp => chmodSync(temp, stat.mode));
}

interface Move { from: string; to: string }
interface LinkChange { path: string; before: string; after: string }

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
}

/** Move the pre-.acstack layout (acstack/, docs/adr, root CONTEXT.md, ...) into `<root>/.acstack/`. */
export function migrateOldLayout(root: string): { moved: string[] } {
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
  if (moves.length === 0) return { moved: [] };
  if (present(canonical)) throw new Error(`${canonical}: migration destination already exists; refusing to merge or overwrite project data`);
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

// ---------------------------------------------------------------------------
// Global project data: migrate and relink. Each preflights before writing
// and never touches the Git index.

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function requireLocation(from: string): ProjectLocation {
  const location = locateProject(from);
  if (!location) throw new Error('Not in a Git repository; ACStack keys project data by repository.');
  return location;
}

/**
 * Rename, or across filesystems copy then delete. The copy lands under a
 * temporary name first, so a failed copy never leaves a partial destination.
 */
function moveTree(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try { renameSync(from, to); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    const temp = `${to}.acstack-${process.pid}`;
    try { cpSync(from, temp, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false }); }
    catch (copyError) { rmSync(temp, { recursive: true, force: true }); throw copyError; }
    renameSync(temp, to);
    rmSync(from, { recursive: true });
  }
}

/** The scan for stranded worktrees only informs, so its failure must not mask completed moves. */
function safeStranded(location: ProjectLocation): string[] {
  try { return strandedWorktrees(location); }
  catch (error) { return [`(could not list worktrees: ${(error as Error).message})`]; }
}

/** Other worktrees still holding `.acstack/` changes outside the repository records, which ACStack no longer reads. */
export function strandedWorktrees(location: ProjectLocation): string[] {
  const paths = git(location.main, ['worktree', 'list', '--porcelain']).split('\n')
    .filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length));
  const records = REPO_RECORDS.map(name => `:(exclude)${ACSTACK_DIR}/${name}`);
  return paths.filter(path => existsSync(path) && realpathSync(path) !== realpathSync(location.main)
    && git(path, ['status', '--porcelain', '--ignored', '--untracked-files=all', '--', ACSTACK_DIR, ...records]).trim() !== '');
}

/** Machine-wide files from before ACStack used one root: `XDG_*` still locates the old ones. */
export function legacyGlobalMoves(home: string = ACSTACK_HOME): Move[] {
  const config = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'acstack');
  const data = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'acstack');
  const children = (dir: string, to: string) => existsSync(dir) ? readdirSync(dir).map(name => ({ from: join(dir, name), to: join(to, name) })) : [];
  return [...children(config, home), ...children(data, join(home, 'cache'))];
}

/** Every place legacy data still sits, for the once-per-session warning. */
export function legacyWarnings(from: string = process.cwd()): string[] {
  const warnings = legacyGlobalMoves().length ? ['ACStack settings are still in ~/.config/acstack or ~/.local/share/acstack.'] : [];
  const location = locateProject(from);
  if (location && lstatSync(location.entry, { throwIfNoEntry: false })?.isSymbolicLink()) warnings.push(`${location.entry} is a link left by tracked mode.`);
  else if (location && hasLegacyData(location, from)) warnings.push(`${location.main} still holds project data in the repository beyond ${ACSTACK_DIR}/${DECISIONS_DIR}/ and ${ACSTACK_DIR}/${GLOSSARY}.`);
  return warnings.length ? [...warnings, 'ACStack no longer reads these locations. Stop agents and review servers, back up, then run `acstack project-data migrate` from each repository.'] : [];
}

/** Decisions the user must make before migrate writes: `decisions` and `glossary` move a global record into the repository, `retired` deletes specs/ and domain-map.yaml. */
export type MigrateQuestion = 'decisions' | 'glossary' | 'retired';
export interface MigrateChoices { decisions?: 'move' | 'keep'; glossary?: 'move' | 'keep'; retired?: 'delete' | 'keep' }

const GLOSSARY = 'CONTEXT.md';
const RECORD_NAMES: Record<'decisions' | 'glossary', string> = { decisions: DECISIONS_DIR, glossary: GLOSSARY };
const RETIRED = [SPECS_DIR, DOMAIN_MAP_FILE];

interface Plan {
  location: ProjectLocation;
  top: string | null;
  global: Move[];
  oldLayout: boolean;
  /** The checkout `.acstack/` whose parts move to the project folder, or null. */
  repoData: string | null;
  /** The entry is a tracked-mode link to repoData, removed before the move. */
  link: boolean;
  questions: MigrateQuestion[];
}

/** Check every destination and work out what migrate would ask, without writing. */
function planMigration(from: string): Plan {
  const location = requireLocation(from);
  const global = legacyGlobalMoves();
  for (const move of global) if (present(move.to)) throw new Error(`${move.to}: migration destination already exists; refusing to overwrite`);
  const top = checkoutRoot(from);
  // A repository whose only legacy .acstack/ sits in this worktree migrates from here.
  const roots = [location.main, ...(top && top !== location.main ? [top] : [])];
  let source = roots.find(root => legacyParts(root).length > 0) ?? null;
  for (const root of roots) {
    const data = join(root, ACSTACK_DIR);
    if (present(data) && !lstatSync(data).isDirectory()) throw new Error(`${data} is not a real folder; move its contents into a folder named ${ACSTACK_DIR} first.`);
  }
  const oldLayout = !present(join(location.main, ACSTACK_DIR)) && (hasLegacyProjectData(location.main) || ['CONTEXT.md', join('docs', 'adr'), '.decisions'].some(name => present(join(location.main, name))));
  if (oldLayout) source = location.main;
  const repoData = source && join(source, ACSTACK_DIR);
  const entry = lstatSync(location.entry, { throwIfNoEntry: false });
  const link = !!entry?.isSymbolicLink();
  const linkTarget = repoData ?? join(location.main, ACSTACK_DIR);
  if (link && !(existsSync(location.entry) && present(linkTarget) && realpathSync(location.entry) === realpathSync(linkTarget))) {
    throw new Error(`${location.entry} links to ${readlinkSync(location.entry)}, not to this repository's ${ACSTACK_DIR}/ holding project data. Check it, then remove the link.`);
  }
  const folder = entry && !link ? location.entry : null;
  if (folder && oldLayout) throw new Error(`${folder} already exists; refusing to merge the old acstack/ layout into it.`);
  if (folder && repoData) {
    for (const part of legacyParts(source!)) if (part !== PROJECT_JSON_FILE && present(join(folder, part))) throw new Error(`${join(folder, part)} already exists; refusing to overwrite it with ${join(repoData, part)}. Nothing was moved.`);
  }
  const questions: MigrateQuestion[] = [];
  if (folder) {
    for (const question of ['decisions', 'glossary'] as const) if (present(join(folder, RECORD_NAMES[question]))) questions.push(question);
  }
  const retiredHomes = [folder, repoData, oldLayout ? join(location.main, LEGACY_ACSTACK_DIR) : null];
  if (RETIRED.some(name => retiredHomes.some(home => home && present(join(home, name))))) questions.push('retired');
  return { location, top, global, oldLayout, repoData, link, questions };
}

/** What `migrate` would ask about in this repository. */
export function migrationQuestions(from: string): MigrateQuestion[] {
  return planMigration(from).questions;
}

/**
 * Convert a project to the two homes: repository records (decisions/,
 * CONTEXT.md) stay in or move into the current worktree's `.acstack/`, and
 * every other part moves into the real project folder. Removes a tracked-mode
 * link; parts that were committed stay behind as pending Git deletions.
 * Also moves legacy machine-wide files. Throws before writing on any
 * collision, or when a global record needs a choice and none was given.
 */
export function migrateProjectData(from: string, choices: MigrateChoices = {}): { moved: string[]; deleted: string[]; stranded: string[] } {
  const plan = planMigration(from);
  const { location, top } = plan;
  for (const question of ['decisions', 'glossary'] as const) {
    if (!plan.questions.includes(question) || choices[question] === 'keep') continue;
    if (!choices[question]) throw new Error(`${join(location.entry, RECORD_NAMES[question])} belongs in the repository now. Choose with --${question} move or --${question} keep.`);
    if (!top) throw new Error(`No checkout to move ${RECORD_NAMES[question]} into.`);
    const to = join(top, ACSTACK_DIR, RECORD_NAMES[question]);
    if (present(to)) throw new Error(`${to} already exists; refusing to overwrite it. Nothing was moved.`);
  }
  const moved: string[] = [];
  const deleted: string[] = [];
  if (plan.oldLayout) moved.push(...migrateOldLayout(location.main).moved.map(path => join(location.main, path)));
  if (plan.link) unlinkSync(location.entry);
  const parts = plan.repoData ? legacyParts(dirname(plan.repoData)) : [];
  if (parts.length) {
    const repoData = plan.repoData!;
    for (const part of parts) {
      if (part === PROJECT_JSON_FILE) { rmSync(join(repoData, part)); continue; }
      moveTree(join(repoData, part), join(location.entry, part));
      moved.push(join(location.entry, part));
    }
    mkdirSync(location.entry, { recursive: true });
    recordProject(location);
    removeManagedGitignoreBlock(dirname(repoData));
    if (readdirSync(repoData).length === 0) rmdirSync(repoData);
  }
  for (const question of ['decisions', 'glossary'] as const) {
    if (!plan.questions.includes(question) || choices[question] !== 'move') continue;
    const to = join(top!, ACSTACK_DIR, RECORD_NAMES[question]);
    moveTree(join(location.entry, RECORD_NAMES[question]), to);
    moved.push(to);
  }
  if (choices.retired === 'delete') {
    for (const name of RETIRED) {
      const path = join(location.entry, name);
      if (present(path)) { rmSync(path, { recursive: true }); deleted.push(path); }
    }
  }
  for (const move of plan.global) { moveTree(move.from, move.to); moved.push(move.to); }
  for (const dir of new Set(plan.global.map(move => dirname(move.from)))) if (readdirSync(dir).length === 0) rmdirSync(dir);
  return { moved, deleted, stranded: safeStranded(location) };
}

/** Give the named orphaned entry, left by a moved repository, this repository's key. */
export function relinkProject(from: string, name: string): { from: string; to: string } {
  const location = requireLocation(from);
  if (present(location.entry)) throw new Error(`${location.entry} already exists; nothing to relink.`);
  const orphans = findOrphans(location);
  const orphan = orphans.find(path => basename(path) === name);
  if (!orphan) throw new Error(orphans.length ? `${name} is not an orphaned entry for this repository. Candidates: ${orphans.map(path => basename(path)).join(', ')}.` : 'No orphaned project entry found for this repository.');
  renameSync(orphan, location.entry);
  recordProject(location);
  return { from: orphan, to: location.entry };
}

