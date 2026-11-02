import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { ACSTACK_DIR, LEGACY_ACSTACK_DIR, PROJECT_FILE, DOMAIN_MAP_FILE, MAPS_DIR, SPECS_DIR, CHANGES_DIR, ARCHIVE_DIR, DECISION_LOGS_DIR, PROJECTS_DIR, PROJECT_JSON_FILE } from './constants.js';

const PLUGIN_MARKER = join('.claude-plugin', 'plugin.json');

/**
 * Walk up from startDir, inclusive, for the nearest directory holding marker.
 *
 * The marker may be a nested path such as `.claude-plugin/plugin.json`, not
 * only a bare filename. Stops at the filesystem root and returns null when no
 * ancestor matches.
 */
export function findUp(startDir: string, marker: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Recognize pre-.acstack project records without mistaking an authored acstack source directory for metadata. */
export function hasLegacyProjectData(root: string): boolean {
  const legacy = join(root, LEGACY_ACSTACK_DIR);
  if (!lstatSync(legacy, { throwIfNoEntry: false })?.isDirectory()) return false;
  // Keep known record links recognizable when another checkout moves first.
  return [PROJECT_FILE, DOMAIN_MAP_FILE].some(name => {
    const entry = lstatSync(join(legacy, name), { throwIfNoEntry: false });
    return entry?.isFile() || entry?.isSymbolicLink();
  }) || ['alignment-packs', 'design-reviews', MAPS_DIR, SPECS_DIR, CHANGES_DIR, ARCHIVE_DIR, DECISION_LOGS_DIR].some(name => {
    const entry = lstatSync(join(legacy, name), { throwIfNoEntry: false });
    return entry?.isDirectory() || entry?.isSymbolicLink();
  });
}

/** Project data exists but cannot be used until the user runs the command the message names. */
export class ProjectDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectDataError';
  }
}

export const LEGACY_MESSAGE = 'Legacy ACStack project data found. Stop review servers and agents, back up the project, then run `acstack project-data migrate` from the repository.';

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** The top of the checkout holding `from`, or null outside Git. */
export function checkoutRoot(from: string = process.cwd()): string | null {
  return git(from, ['rev-parse', '--show-toplevel']) || null;
}

/** Where one repository's project data is looked up; every worktree of the repo gets the same answer. */
export interface ProjectLocation {
  /** `<main checkout folder name>-<6 hex of sha256(real shared git folder)>` */
  key: string;
  /** The real path of the shared git folder. */
  commonDir: string;
  /** The main checkout; for a bare repository, the bare folder itself. */
  main: string;
  /** True for a bare repository, whose main checkout holds no files. */
  bare: boolean;
  /** `<ACSTACK_HOME>/projects/<key>`: a real folder in global mode, a link in tracked mode. */
  entry: string;
}

/** Locate the project entry for the repository holding `from`, or null outside Git. */
export function locateProject(from: string = process.cwd(), projects: string = PROJECTS_DIR): ProjectLocation | null {
  const common = git(from, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  // .native corrects letter case on macOS and Windows, so `cd ~/Code` and `cd ~/code` share a key.
  const commonDir = realpathSync.native(common);
  const { main, bare } = mainCheckout(commonDir, from);
  const key = `${basename(main)}-${createHash('sha256').update(commonDir).digest('hex').slice(0, 6)}`;
  return { key, commonDir, main, bare, entry: join(projects, key) };
}

/** A normal repo's checkout is the parent of `.git`; submodules and separate git folders name theirs in core.worktree. */
function mainCheckout(commonDir: string, from: string): { main: string; bare: boolean } {
  if (basename(commonDir) === '.git') return { main: dirname(commonDir), bare: false };
  const worktree = git(commonDir, ['config', 'core.worktree']);
  if (worktree) return { main: realpathSync.native(resolve(commonDir, worktree)), bare: false };
  if (git(commonDir, ['rev-parse', '--is-bare-repository']) === 'true') return { main: commonDir, bare: true };
  return { main: realpathSync.native(checkoutRoot(from) ?? from), bare: false };
}

/** True when the main checkout commits `.acstack/project.yaml`, the tracked-mode marker. */
export function hasTrackedProject(location: ProjectLocation): boolean {
  return !location.bare && existsSync(join(location.main, ACSTACK_DIR, PROJECT_FILE))
    && !!git(location.main, ['ls-files', '--', `${ACSTACK_DIR}/${PROJECT_FILE}`]);
}

/** A sibling entry for the same folder name whose recorded repository no longer exists. */
export function findOrphans(location: ProjectLocation): string[] {
  const projects = dirname(location.entry);
  if (!existsSync(projects)) return [];
  const prefix = `${basename(location.main)}-`;
  return readdirSync(projects).filter(name => name.startsWith(prefix) && /^[0-9a-f]{6}$/.test(name.slice(prefix.length)) && name !== location.key)
    .map(name => join(projects, name))
    .filter(path => {
      if (lstatSync(path).isSymbolicLink()) return !existsSync(path);
      const recorded = recordedCommonDir(path);
      return recorded !== null && !existsSync(recorded);
    });
}

/** Warnings naming each entry this repository could take over with `relink`. */
export function orphanWarnings(location: ProjectLocation): string[] {
  if (lstatSync(location.entry, { throwIfNoEntry: false })) return [];
  return findOrphans(location).map(orphan => `${orphan} belonged to a repository that is no longer there. If that was this repository before it moved, run \`acstack project-data relink ${basename(orphan)}\`.`);
}

export function recordedCommonDir(folder: string): string | null {
  try { return (JSON.parse(readFileSync(join(folder, PROJECT_JSON_FILE), 'utf8')) as { commonDir?: unknown }).commonDir as string ?? null; }
  catch { return null; }
}

/** Record a global-mode folder's shared git folder, so a moved repo can be relinked. */
export function recordProject(location: ProjectLocation): void {
  writeFileSync(join(location.entry, PROJECT_JSON_FILE), JSON.stringify({ commonDir: location.commonDir }, null, 2) + '\n');
}

/** Link a project entry to a tracked `.acstack/`; Windows gets a junction, which needs no privilege. */
export function linkTracked(location: ProjectLocation): void {
  mkdirSync(dirname(location.entry), { recursive: true });
  symlinkSync(join(location.main, ACSTACK_DIR), location.entry, process.platform === 'win32' ? 'junction' : 'dir');
}

/**
 * Find this repository's project folder: the real path every project file is
 * joined onto, or null when the repo has no ACStack data yet or `from` is not
 * in a Git repository.
 *
 * Throws, naming the command that fixes it, on legacy data and on a repo
 * holding both a global folder and a committed `.acstack/`. A possible orphan
 * is only a warning (see orphanWarnings): it may belong to another repository
 * with the same folder name, or sit on an unmounted drive.
 */
export function findProjectRoot(from: string = process.cwd()): string | null {
  const location = locateProject(from);
  if (!location) return null;
  const entry = lstatSync(location.entry, { throwIfNoEntry: false });
  if (entry?.isSymbolicLink()) {
    if (!existsSync(location.entry)) throw new ProjectDataError(`${location.entry} links to ${join(location.main, ACSTACK_DIR)}, which does not exist. Restore it or run \`acstack project-data mode global\`.`);
    return realpathSync(location.entry);
  }
  if (entry) {
    if (hasTrackedProject(location)) throw new ProjectDataError(`This repository has both a project folder (${location.entry}) and a committed ${ACSTACK_DIR}/. Choose one with \`acstack project-data mode tracked\` or \`acstack project-data mode global\`.`);
    // Setup only creates the folder; record the repo here so a later move can be relinked.
    if (!existsSync(join(location.entry, PROJECT_JSON_FILE))) recordProject(location);
    return realpathSync(location.entry);
  }
  if (hasTrackedProject(location)) {
    linkTracked(location);
    return realpathSync(location.entry);
  }
  if (hasLegacyData(location, from)) throw new ProjectDataError(LEGACY_MESSAGE);
  return null;
}

/** Legacy data in the main checkout or this worktree: an untracked `.acstack/`, or the older `acstack/` layout. */
export function hasLegacyData(location: ProjectLocation, from: string = process.cwd()): boolean {
  const top = git(from, ['rev-parse', '--show-toplevel']);
  return [location.main, ...(top ? [top] : [])].some(root => existsSync(join(root, ACSTACK_DIR)) || hasLegacyProjectData(root));
}

/**
 * Find the plugin root: the directory holding .claude-plugin/plugin.json.
 *
 * CLAUDE_PLUGIN_ROOT wins when it is set and the directory it names really
 * holds the marker. A stale variable falls back to walking up, so a wrong
 * environment cannot break the CLI.
 *
 * The default start is the running CLI file rather than the user's project
 * root, because the files looked for here ship with the plugin. That resolves
 * for both the bundled layout (<plugin>/cli/dist/index.js) and the source
 * layout (<plugin>/cli/src/lib/project.ts), because Node resolves the
 * ~/.claude/acstack/bin/acstack symlink before setting import.meta.dirname.
 */
export function findPluginRoot(startDir: string = import.meta.dirname): string | null {
  const fromEnv = process.env.CLAUDE_PLUGIN_ROOT;
  if (fromEnv && existsSync(join(fromEnv, PLUGIN_MARKER))) return resolve(fromEnv);
  return findUp(startDir, PLUGIN_MARKER);
}
