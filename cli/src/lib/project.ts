import { existsSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ACSTACK_DIR, LEGACY_ACSTACK_DIR, PROJECT_FILE, DOMAIN_MAP_FILE, MAPS_DIR, SPECS_DIR, CHANGES_DIR, ARCHIVE_DIR, DECISION_LOGS_DIR } from './constants.js';

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

/** Recognize project records without mistaking an authored acstack source directory for metadata. */
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

/** Find the nearest canonical directory or recognized legacy project records. */
export function findProjectRoot(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, ACSTACK_DIR)) || hasLegacyProjectData(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
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
