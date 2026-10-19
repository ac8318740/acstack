import { join } from 'node:path';
import { homedir } from 'node:os';

export const ACSTACK_DIR = '.acstack';
export const LEGACY_ACSTACK_DIR = 'acstack';
export const DECISIONS_DIR = 'decisions';
export const DECISION_LOGS_DIR = 'decision-logs';
export const VERIFICATION_DIR = 'verification';
export const CHANGES_DIR = 'changes';
export const MAPS_DIR = 'maps';
export const SPECS_DIR = 'specs';
export const ARCHIVE_DIR = 'archive';
export const PROJECT_FILE = 'project.yaml';
export const DOMAIN_MAP_FILE = 'domain-map.yaml';

/**
 * One file under a project's `.acstack/`, either as an absolute path or - with
 * no `root` to give - as the relative path a message names it by.
 *
 * Functions rather than constants like `GLOBAL_CONFIG_FILE`, because the root
 * is only known once a project has been found. Written here anyway, beside
 * the names they join, so the several readers and writers of each file cannot
 * end up naming it in several ways.
 */
export function acstackFile(name: string, root?: string): string {
  const relative = join(ACSTACK_DIR, name);
  return root === undefined ? relative : join(root, relative);
}

/** The project.yaml `acstack config` reads and writes. */
export function projectFile(root?: string): string {
  return acstackFile(PROJECT_FILE, root);
}

/** The domain map spec sync reads, and `acstack config check` reports on. */
export function domainMapFile(root?: string): string {
  return acstackFile(DOMAIN_MAP_FILE, root);
}

/**
 * Where the per-project-type starting configurations live, relative to the
 * plugin root. `/acstack:setup` copies one into a new project.yaml, and
 * `acstack config set profile <name>` validates against the names here.
 */
export const PROFILES_DIR = 'profiles';

/**
 * Files a project carries under .acstack/, written by the setup skill and
 * read back by `acstack config check`. Named here rather than at the point of
 * use so the skill that writes one and the check that looks for it can never
 * drift on to different filenames.
 */
export const AGENT_BROWSER_JSON_FILE = join(ACSTACK_DIR, 'agent-browser.json');
export const VERIFICATION_KNOWLEDGE_FILE = join(ACSTACK_DIR, VERIFICATION_DIR, 'VERIFICATION-KNOWLEDGE.md');

/** The agent-browser CLI, as it is named on PATH and installed from npm. */
export const AGENT_BROWSER_BIN = 'agent-browser';

/** Where Claude Code keeps its settings, in a project and under a home directory. */
export const CLAUDE_DIR = '.claude';
export const CLAUDE_SETTINGS_FILE = 'settings.json';
export const CLAUDE_LOCAL_SETTINGS_FILE = 'settings.local.json';

/**
 * Claude Code's config root: the directory holding its plugins and its
 * user-level settings.
 *
 * `CLAUDE_CONFIG_DIR` moves the whole root, so it replaces `~/.claude` rather
 * than adding a second place to look. An empty value is not a value, so it
 * leaves HOME deciding.
 *
 * A function rather than a constant, because `homedir()` has to be the HOME
 * the process was actually given rather than the one this module loaded under.
 */
export function claudeConfigRoot(): string {
  const stated = process.env.CLAUDE_CONFIG_DIR;
  return stated ? stated : join(homedir(), CLAUDE_DIR);
}

/**
 * The output style this plugin ships, spelled the way Claude Code names it in
 * a settings file: the plugin's name, a colon, and the style's basename.
 * Written down once here so the check that reports which style is selected
 * and anything that selects one can never drift apart on the string.
 */
export const ACSTACK_OUTPUT_STYLE = 'acstack:ac-writing-style';

/**
 * The vocabulary the prose linter reads its deny lists from, relative to the
 * plugin root. This is the single place the path is written down; everything
 * else composes it with findPluginRoot().
 */
export const VOCABULARY_PATH = join('skills', 'writing', 'vocabulary.md');

export const GLOBAL_CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'acstack'
);
export const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, 'config.json');

export const GLOBAL_DATA_DIR = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
  'acstack'
);
