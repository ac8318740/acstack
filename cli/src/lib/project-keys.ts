/**
 * The schema of `.acstack/project.yaml`: every key it holds, what each one
 * accepts, and the default the reference documents for it.
 *
 * `project-config.ts` reads and writes the file; this module says what a
 * value means, so the writer and every reader agree on one schema.
 */

import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  ConfigValidationError,
  invalidEnumValue,
  invalidValue,
  parseBooleanWord,
} from './global-config.js';
import { BROWSER_FALLBACK_VALUES, BROWSER_MODE_PRIORITY } from './host-status.js';
import { PROFILES_DIR } from './constants.js';
import { findPluginRoot } from './project.js';

/**
 * What one numeric `.acstack/project.yaml` key accepts.
 *
 * `number` on its own is the constraint on none of these keys, and a value
 * outside the range is not caught anywhere else: the code that dials a port
 * or compares a token count refuses it silently, long after the command that
 * wrote it exited 0. So the bound the reader relies on is stated here, where
 * it can be reported to the person typing the value.
 */
export interface NumberSpec {
  kind: 'number';
  /** Whether a fraction is refused, because the value is counted rather than measured. */
  integer?: true;
  /** The lowest value accepted, inclusive. */
  min?: number;
  /** The highest value accepted, inclusive. */
  max?: number;
}

/**
 * What one `.acstack/project.yaml` key accepts.
 *
 * `profile` and `context_thresholds` are their own kinds rather than an enum
 * and a string, because neither set is known at compile time: the profile
 * names come from the `profiles/` directory on disk, and a threshold list is
 * a shape rather than a value.
 */
export type ProjectKeySpec =
  | { kind: 'boolean' }
  | NumberSpec
  | { kind: 'string' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'profile' }
  | { kind: 'thresholds' };

/**
 * A whole count of turns or of tokens, which every `workflow.handoff` numeric
 * key but `context_window` holds.
 *
 * All four are compared and counted rather than measured, so a fraction has
 * no meaning and a negative is a threshold that can never be crossed - or,
 * for `ack_turns`, a wait that is over before it starts. Zero is allowed:
 * none of the four is required to be positive.
 */
const COUNT: NumberSpec = { kind: 'number', integer: true, min: 0 };

/**
 * The key that says whether a UI change is verified in a real browser before
 * it lands.
 *
 * Named here, where the schema and the default table both state it, because
 * `acstack config check` reports the flag and has to name the key the user
 * would go and set. A second spelling over there is a row one rename away
 * from sending the user to a key nothing reads.
 */
export const FRONTEND_VERIFICATION_KEY = 'workflow.frontend_verification';

/**
 * The key that says whether a design change goes through a design review
 * before it lands.
 *
 * Named here for the same reason as the key above it: the schema, the default
 * table and everything that reports the flag all have to spell it one way.
 */
export const DESIGN_REVIEW_KEY = 'workflow.design_review';

/**
 * Every key `.acstack/project.yaml` holds, in the order docs/config-reference.md
 * documents them. This table is the schema: a key absent from it is a key
 * `acstack config set` refuses, so adding a documented key here is the whole
 * job of teaching the command to write it.
 *
 * Section keys such as `workflow` and `frontend.browser` are deliberately
 * absent. They name a block rather than a value, and the reference gives no
 * spelling for assigning a whole block on a command line.
 */
export const PROJECT_KEYS: Readonly<Record<string, ProjectKeySpec>> = {
  profile: { kind: 'profile' },

  'workflow.grilling.questions': { kind: 'enum', values: ['tool', 'inline'] },
  [FRONTEND_VERIFICATION_KEY]: { kind: 'boolean' },
  [DESIGN_REVIEW_KEY]: { kind: 'boolean' },
  'workflow.maps.tracker': { kind: 'enum', values: ['github', 'files'] },
  'workflow.maps.persist': { kind: 'boolean' },
  'workflow.read_guard': { kind: 'boolean' },
  'workflow.read_guard_bytes': { kind: 'number', integer: true, min: 1 },
  'workflow.handoff.agent': { kind: 'string' },
  'workflow.handoff.ack_turns': COUNT,
  'workflow.handoff.self_invoke': { kind: 'boolean' },
  'workflow.handoff.nudge_warn': COUNT,
  'workflow.handoff.nudge_severe': COUNT,
  'workflow.handoff.nudge_step': COUNT,
  'workflow.handoff.context_thresholds': { kind: 'thresholds' },
  'workflow.handoff.context_window': { kind: 'number', integer: true, min: 1 },
  'workflow.handoff.memory_mb': COUNT,

  'commands.test': { kind: 'string' },
  'commands.test_collect': { kind: 'string' },
  'commands.build': { kind: 'string' },
  'commands.lint': { kind: 'string' },
  'commands.typecheck': { kind: 'string' },
  'commands.format': { kind: 'string' },

  'venv.activate': { kind: 'string' },

  'frontend.directory': { kind: 'string' },
  'frontend.dev_server_url': { kind: 'string' },
  'frontend.dev_server_check': { kind: 'string' },
  'frontend.helpers_dir': { kind: 'string' },
  'frontend.commands.dev': { kind: 'string' },
  'frontend.commands.build': { kind: 'string' },
  'frontend.commands.lint': { kind: 'string' },
  'frontend.commands.test': { kind: 'string' },
  // Both lists come from host-status.ts, which owns the mode names and reads
  // them at run time. A schema spelling them again would be a second list to
  // keep in step, and the file that resolves a mode would not know it existed.
  'frontend.browser.mode': { kind: 'enum', values: BROWSER_MODE_PRIORITY },
  'frontend.browser.fallback': { kind: 'enum', values: BROWSER_FALLBACK_VALUES },
  'frontend.browser.cdp_port': { kind: 'number', integer: true, min: 1, max: 65535 },
};

/**
 * Whether `key` is a personal preference rather than a project setting.
 *
 * A preference lives in the user-level config so it follows the person across
 * projects; a project.yaml that states it still overrides it there.
 */
export function isUserPreferenceKey(key: string): boolean {
  return key === 'workflow.grilling.questions' || key.startsWith('workflow.handoff.');
}

/** Every project key, in schema order, for a message that has to name them. */
export const PROJECT_KEY_LIST: readonly string[] = Object.keys(PROJECT_KEYS);

/** The spec for `key`, or undefined when the project schema does not know it. */
export function projectKeySpec(key: string): ProjectKeySpec | undefined {
  return PROJECT_KEYS[key];
}

/** The profile names `profiles/` offers, or an empty list when it cannot be read. */
function profileNames(): readonly string[] {
  const pluginRoot = findPluginRoot();
  if (!pluginRoot) return [];
  const dir = join(pluginRoot, PROFILES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.yaml'))
    .map(name => basename(name, '.yaml'))
    .sort();
}

function parseEnum(key: string, raw: string, values: readonly string[]): string {
  if (values.includes(raw)) return raw;
  throw invalidEnumValue(key, raw, values);
}

/**
 * The range clause of a numeric key's expectation, as the message states it.
 *
 * A bound the user got wrong has to be named, not merely implied: someone who
 * typed 70000 for a port learns nothing from "invalid value" and everything
 * from the ceiling.
 */
function numberRange(spec: NumberSpec): string {
  const { min, max } = spec;
  if (min !== undefined && max !== undefined) return ` from ${min} to ${max}`;
  if (min !== undefined) return `, ${min} or more`;
  if (max !== undefined) return `, ${max} or less`;
  return '';
}

/** The whole of what a numeric key accepts, in one sentence. */
function numberExpectation(spec: NumberSpec): string {
  return `Expected a ${spec.integer ? 'whole number' : 'number'}${numberRange(spec)}.`;
}

/**
 * Read `raw` as the number `key` accepts, or throw naming the whole range.
 *
 * One message for every way the value can be wrong. A user who typed `0.5`
 * where a count belongs and a user who typed `-1` made different mistakes,
 * but both need the same sentence to fix them, and splitting it would leave
 * each of them told half of the constraint.
 */
function parseNumber(key: string, raw: string, spec: NumberSpec): number {
  const value = Number(raw);
  const expected = numberExpectation(spec);

  if (raw.trim() === '' || !Number.isFinite(value)) throw invalidValue(key, raw, expected);
  if (spec.integer && !Number.isInteger(value)) throw invalidValue(key, raw, expected);
  if (spec.min !== undefined && value < spec.min) throw invalidValue(key, raw, expected);
  if (spec.max !== undefined && value > spec.max) throw invalidValue(key, raw, expected);

  return value;
}

/** A percentage of the context window, such as `40%`, kept as written. */
const PERCENTAGE = /^\d+(\.\d+)?%$/;

/**
 * One entry of `workflow.handoff.context_thresholds`: a token count as a
 * number, or a percentage as the string the hook resolves against the window.
 * A bare `40` would be forty tokens, so the percent sign has to survive.
 */
function parseThresholdEntry(key: string, entry: unknown): number | string {
  if (typeof entry === 'number' && Number.isFinite(entry)) return entry;

  if (typeof entry === 'string') {
    const text = entry.trim();
    if (PERCENTAGE.test(text)) return text;
    if (text !== '' && Number.isFinite(Number(text))) return Number(text);
  }

  throw invalidValue(
    key,
    typeof entry === 'string' ? entry.trim() : (JSON.stringify(entry) ?? ''),
    'Every entry must be a number of tokens, such as 150000, ' +
      'or a percentage of the context window, such as 40%.'
  );
}

/**
 * The two spellings the reference gives for a threshold ladder: a
 * comma-separated list, `150000,300000`, and YAML flow style,
 * `[150000, 300000]`. Both land as the same list.
 */
function parseThresholds(key: string, raw: string): (number | string)[] {
  const trimmed = raw.trim();
  let entries: unknown[];

  if (trimmed.startsWith('[')) {
    let flow: unknown;
    try {
      flow = parseYaml(trimmed);
    } catch (err) {
      throw invalidValue(key, raw, `Not a YAML list: ${(err as Error).message}`);
    }
    if (!Array.isArray(flow)) throw invalidValue(key, raw, 'Expected a YAML list.');
    entries = flow;
  } else {
    entries = trimmed.split(',');
  }

  if (entries.length === 0) throw invalidValue(key, raw, 'Expected at least one entry.');
  return entries.map(entry => parseThresholdEntry(key, entry));
}

/**
 * Validate and coerce the raw string `raw` for the project key `key`.
 *
 * Throws `ConfigValidationError` for anything the schema refuses, before
 * anything has been written, so a rejected value leaves the file untouched.
 */
export function parseProjectValue(key: string, raw: string): unknown {
  const spec = projectKeySpec(key);
  if (!spec) throw new ConfigValidationError(`Unknown config key "${key}".`);

  switch (spec.kind) {
    case 'boolean':
      return parseBooleanWord(key, raw);
    case 'number':
      return parseNumber(key, raw, spec);
    case 'string':
      return raw;
    case 'enum':
      return parseEnum(key, raw, spec.values);
    case 'profile': {
      const names = profileNames();
      // Nothing to validate against when the profiles directory is out of
      // reach, so take the name as given rather than refuse every value.
      return names.length === 0 ? raw : parseEnum(key, raw, names);
    }
    case 'thresholds':
      return parseThresholds(key, raw);
  }
}

/**
 * The default `docs/config-reference.md` gives each key, spelled as the
 * reference spells it.
 *
 * Only literals are here. A key whose default the reference describes rather
 * than states - `from the profile`, `inferred from the model id`, one value
 * for Node and another for Python, a path built out of another key - has no
 * single answer to name, and naming one would report a decision the reference
 * never made. `config get` then says the key is unset and stops there.
 */
export const PROJECT_KEY_DEFAULTS: Readonly<Record<string, string>> = {
  'workflow.grilling.questions': 'tool',
  [FRONTEND_VERIFICATION_KEY]: 'false',
  [DESIGN_REVIEW_KEY]: 'false',
  'workflow.maps.persist': 'false',
  'workflow.read_guard': 'true',
  'workflow.read_guard_bytes': '32768',
  'workflow.handoff.agent': 'claude',
  'workflow.handoff.ack_turns': '5',
  'workflow.handoff.self_invoke': 'true',
  'workflow.handoff.nudge_warn': '200000',
  'workflow.handoff.nudge_severe': '500000',
  'workflow.handoff.nudge_step': '100000',
  'workflow.handoff.memory_mb': '2048',

  'frontend.directory': 'frontend/',
  'frontend.dev_server_url': 'http://localhost:3000',
};

/** The documented default for `key`, or undefined where the reference gives none. */
export function projectKeyDefault(key: string): string | undefined {
  return PROJECT_KEY_DEFAULTS[key];
}

/**
 * The documented default for a boolean `key`, for the readers that apply one
 * rather than print it.
 *
 * The table above spells every default the way the reference spells it, which
 * is text, and a reader deciding whether to run a step holds a yes or a no.
 * The two meet here, so a caller needing the boolean names this instead of
 * writing the value down a second time - and `config get` then reports the
 * default `config check` acted on.
 *
 * A key the reference gives no default for has no answer to give. Standing in
 * `false` would apply a decision nobody documented, and it would apply it
 * silently, so this refuses instead - as a plain `Error`, keeping its stack.
 * Nothing a user typed reaches here: the key is written into the source of
 * whichever reader asked, so the reader is the thing to go and fix, and a red
 * line and exit 1 would file that as a value somebody mistyped.
 */
export function projectKeyDefaultFlag(key: string): boolean {
  const stated = projectKeyDefault(key);
  if (stated === undefined) {
    throw new Error(`${key} has no documented default to apply.`);
  }
  return parseBooleanWord(key, stated);
}
