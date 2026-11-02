// The large-read guard's policy, shared by hooks/read-guard.mjs (Claude Code
// and Codex) and pi/extension.ts. It knows nothing about any harness: callers
// say whether the agent is a main agent and pass a retry ledger.
//
// A main agent's first whole-file read of a large file is blocked with a
// redirect message; an identical repeat passes. Every error allows the read,
// because the guard saves context and must never trap an agent.
//
// Design: .acstack/designs/large-read-guard/overview.md

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MIN_BYTES = 32768;

const SHELL_READERS = new Set(['cat', 'less', 'more', 'nl', 'bat']);

/** True when a launcher marked this process as anything but a main agent. */
export function envSaysNotMain(env = process.env) {
  const role = env.ACSTACK_AGENT_ROLE;
  return Boolean(role && role !== 'main') || Boolean(env.AC_TEAMS_MEMBER);
}

/**
 * The one settings function: workflow.read_guard and
 * workflow.read_guard_bytes from project.yaml in the repository's project
 * folder. Hand-rolled like the other hooks' readers, because no YAML library
 * is guaranteed at hook time. pi passes the folder it already resolved.
 */
export function readGuardSettings(cwd, folder = projectFolder(cwd)) {
  const settings = { enabled: true, minBytes: DEFAULT_MIN_BYTES };
  const yaml = folder ? readText(path.join(folder, 'project.yaml')) : undefined;
  if (yaml === undefined) return settings;
  const stack = [];
  for (const raw of yaml.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const stripped = raw.replace(/^ +/, '');
    const indent = raw.length - stripped.length;
    if (stripped.startsWith('- ') || !stripped.includes(':')) continue;
    const sep = stripped.indexOf(':');
    const key = stripped.slice(0, sep).trim().replace(/^["']+|["']+$/g, '');
    const value = stripped.slice(sep + 1).split('#')[0].trim().replace(/^["']+|["']+$/g, '');
    while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop();
    const keyPath = [...stack.map(([, k]) => k), key].join('.');
    if (!value) {
      stack.push([indent, key]);
      continue;
    }
    if (keyPath === 'workflow.read_guard') settings.enabled = !['false', 'no', 'off'].includes(value.toLowerCase());
    if (keyPath === 'workflow.read_guard_bytes' && /^\d+$/.test(value)) settings.minBytes = Number(value);
  }
  return settings;
}

const CLI = fileURLToPath(new URL('../../cli/bin/acstack.js', import.meta.url));

/** The project folder the CLI reports for cwd, or undefined outside a project. */
function projectFolder(cwd) {
  const result = spawnSync(process.execPath, [CLI, 'project-data', 'path'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The file a tool call reads whole, or undefined when the call is not a
 * whole-file read: a ranged read, a pipe, a script, or anything unrecognised.
 */
export function wholeReadTarget(toolName, input, cwd) {
  if (!input || typeof input !== 'object') return undefined;
  const name = String(toolName).toLowerCase();
  if (name === 'read') {
    if (input.offset != null || input.limit != null) return undefined;
    const file = input.file_path ?? input.path;
    return typeof file === 'string' && file ? resolvePath(file, cwd) : undefined;
  }
  if (name === 'bash') {
    const file = shellReadTarget(input.command);
    return file === undefined ? undefined : resolvePath(file, cwd);
  }
  return undefined;
}

/** The single file of `cat|less|more|nl|bat [-flags] <file>`, nothing more. */
export function shellReadTarget(command) {
  if (typeof command !== 'string') return undefined;
  // Pipes, redirects, chains, substitutions, globs, and variables all pass.
  if (/[|;&<>`$()*?\n\\]/.test(command)) return undefined;
  const words = [];
  for (const match of command.trim().matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)) {
    words.push(match[1] ?? match[2] ?? match[3]);
  }
  const [reader, ...args] = words;
  if (!SHELL_READERS.has(reader)) return undefined;
  const flags = args.filter((arg) => arg.startsWith('-'));
  const files = args.filter((arg) => !arg.startsWith('-'));
  // bat -r / --line-range reads a range.
  if (reader === 'bat' && flags.some((flag) => flag === '-r' || flag.startsWith('--line-range'))) return undefined;
  return files.length === 1 ? files[0] : undefined;
}

function resolvePath(file, cwd) {
  if (file === '~' || file.startsWith('~/')) return path.join(os.homedir(), file.slice(1));
  return path.resolve(cwd, file);
}

/**
 * Decide one tool call. Returns { block: false } or { block: true, message }.
 * `ledger` has has(key) and add(key); add throws when it cannot record, and
 * then the read is allowed so a repeat can never be trapped.
 */
export function decide({ toolName, toolInput, cwd, main, ledger, settings }) {
  try {
    if (!main || !ledger) return { block: false };
    const file = wholeReadTarget(toolName, toolInput, cwd);
    if (!file) return { block: false };
    // Resolved only for a whole-file read, since it costs a CLI call.
    settings ??= readGuardSettings(cwd);
    if (!settings.enabled) return { block: false };
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < settings.minBytes) return { block: false };
    const key = `${fs.realpathSync(file)}\0${stat.size}\0${stat.mtimeMs}`;
    if (ledger.has(key)) return { block: false };
    ledger.add(key);
    return { block: true, message: blockMessage(stat.size) };
  } catch {
    return { block: false };
  }
}

export function blockMessage(bytes) {
  const kb = Math.round(bytes / 1024);
  const tokens = Math.round(bytes / 4 / 1000) * 1000;
  return [
    `This file is ${kb} KB (about ${tokens.toLocaleString('en-US')} tokens), and reading all of it is usually unnecessary. Instead:`,
    '',
    '- Search for what you need, then read only that range',
    "- Or hand the question to an investigator, as ACStack's Delegate investigation section describes",
    '',
    'If you really need the whole file, repeat this exact read and it will go through.',
  ].join('\n');
}

/**
 * A per-session ledger file in a folder only this user can open:
 * ${TMPDIR:-/tmp}/acstack-read-guard-<uid>/<session_id>.json.
 * Returns undefined without a session id, so the guard stays off.
 */
export function fileLedger(sessionId, tmpdir = os.tmpdir()) {
  if (typeof sessionId !== 'string' || !sessionId) return undefined;
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const dir = path.join(tmpdir, `acstack-read-guard-${uid ?? os.userInfo().username}`);
  const name = /^[A-Za-z0-9._-]{1,128}$/.test(sessionId) && !sessionId.startsWith('.')
    ? sessionId
    : createHash('sha256').update(sessionId).digest('hex');
  const file = path.join(dir, `${name}.json`);

  const ownedDir = () => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    // Another user's folder could hold planted entries that switch the guard off.
    if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o077) !== 0) {
      throw new Error(`refusing ledger folder ${dir}`);
    }
  };
  const load = () => {
    ownedDir();
    try {
      const keys = JSON.parse(fs.readFileSync(file, 'utf8'));
      return new Set(Array.isArray(keys) ? keys : []);
    } catch {
      return new Set();
    }
  };
  return {
    has: (key) => load().has(key),
    add: (key) => {
      const keys = load().add(key);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...keys]), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
}
