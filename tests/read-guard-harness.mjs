// Checks hooks/lib/read-guard.mjs and hooks/read-guard.mjs. Run by
// tests/test-read-guard.sh, which sets TMPDIR to a scratch folder.
//
// Prints one "ok <name>" or "not ok <name>: <detail>" line per check.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MIN_BYTES, decide, envSaysNotMain, fileLedger, readGuardSettings, shellReadTarget, wholeReadTarget,
} from '../hooks/lib/read-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'rg-'));

function check(name, cond, detail = '') {
  console.log(cond ? `ok ${name}` : `not ok ${name}${detail ? `: ${detail}` : ''}`);
}

function project(name, yaml) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.acstack'), { recursive: true });
  if (yaml !== undefined) fs.writeFileSync(path.join(dir, '.acstack', 'project.yaml'), yaml);
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(DEFAULT_MIN_BYTES));
  fs.writeFileSync(path.join(dir, 'small.txt'), 'x'.repeat(DEFAULT_MIN_BYTES - 1));
  return dir;
}

// Settings
{
  const none = readGuardSettings(project('no-config'));
  check('settings: no project.yaml means on at 32 KB', none.enabled && none.minBytes === 32768);
  const off = readGuardSettings(project('off', 'profile: x\nworkflow:\n  spec_sync: true\n  read_guard: false   # off\n'));
  check('settings: workflow.read_guard false turns the guard off', off.enabled === false);
  for (const spelling of ['no', 'OFF', '"False"']) {
    check(`settings: read_guard ${spelling} turns the guard off`, readGuardSettings(project(`off-${spelling.replace(/"/g, '')}`, `workflow:\n  read_guard: ${spelling}\n`)).enabled === false);
  }
  check('settings: read_guard true leaves it on', readGuardSettings(project('on', 'workflow:\n  read_guard: true\n')).enabled === true);
  const sized = readGuardSettings(project('sized', 'workflow:\n  read_guard_bytes: 65536\n'));
  check('settings: workflow.read_guard_bytes changes the threshold', sized.enabled && sized.minBytes === 65536);
  const other = readGuardSettings(project('other', 'read_guard: false\nworkflow:\n  handoff:\n    read_guard: false\n'));
  check('settings: read_guard outside workflow is ignored', other.enabled === true);
  const nested = path.join(project('nested', 'workflow:\n  read_guard: false\n'), 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  check('settings: found from a subfolder', readGuardSettings(nested).enabled === false);
}

// What counts as a whole-file read
{
  const cwd = '/repo';
  check('target: Read with no range', wholeReadTarget('Read', { file_path: '/repo/a.ts' }, cwd) === '/repo/a.ts');
  check('target: pi read with a relative path', wholeReadTarget('read', { path: 'src/a.ts' }, cwd) === '/repo/src/a.ts');
  check('target: Read with offset is ranged', wholeReadTarget('Read', { file_path: '/a', offset: 10 }, cwd) === undefined);
  check('target: Read with limit is ranged', wholeReadTarget('read', { path: '/a', limit: 50 }, cwd) === undefined);
  check('target: other tools pass', wholeReadTarget('Grep', { pattern: 'x', path: '/a' }, cwd) === undefined);
  check('target: Bash cat file', wholeReadTarget('Bash', { command: 'cat src/a.ts' }, cwd) === '/repo/src/a.ts');
  const whole = ['cat a', 'cat -n a', 'nl -ba a', 'less a', 'more a', 'bat a', "cat 'a b'", '  cat "a"  '];
  for (const cmd of whole) check(`shell: "${cmd}" is a whole read`, shellReadTarget(cmd) !== undefined, String(shellReadTarget(cmd)));
  const passed = [
    'cat a | head', 'cat a > b', 'cat a b', 'cd x && cat a', 'cat a; ls', 'head -n 50 a', 'tail a', "sed -n '1,20p' a",
    'cat $F', 'cat *.ts', 'cat $(ls)', 'bat -r 1:10 a', 'bat --line-range=1:10 a', 'rg foo a', 'cat', 'cat a\ncat b',
  ];
  for (const cmd of passed) check(`shell: "${cmd.replace('\n', '\\n')}" passes`, shellReadTarget(cmd) === undefined, String(shellReadTarget(cmd)));
}

// Decisions
{
  const cwd = project('decide');
  const big = path.join(cwd, 'big.txt');
  const read = (file, extra = {}) => ({ toolName: 'Read', toolInput: { file_path: file, ...extra }, cwd, main: true });
  const ledger = new Set();
  const first = decide({ ...read(big), ledger });
  check('decide: first whole read of a large file blocks', first.block === true);
  check('decide: the message names the size and the retry', /32 KB/.test(first.message) && /repeat this exact read/.test(first.message));
  check('decide: an identical repeat passes', decide({ ...read(big), ledger }).block === false);
  check('decide: a Bash cat of the same file also passes after the block',
    decide({ toolName: 'Bash', toolInput: { command: 'cat big.txt' }, cwd, main: true, ledger }).block === false);
  fs.appendFileSync(big, 'more');
  check('decide: a changed file blocks again', decide({ ...read(big), ledger }).block === true);
  check('decide: a file just under the threshold passes', decide({ ...read(path.join(cwd, 'small.txt')), ledger: new Set() }).block === false);
  check('decide: a ranged read passes', decide({ ...read(big, { limit: 100 }), ledger: new Set() }).block === false);
  check('decide: a missing file passes', decide({ ...read(path.join(cwd, 'nope')), ledger: new Set() }).block === false);
  check('decide: a directory passes', decide({ ...read(cwd), ledger: new Set() }).block === false);
  check('decide: a non-main agent passes', decide({ ...read(big), main: false, ledger: new Set() }).block === false);
  check('decide: no ledger passes', decide({ ...read(big), ledger: undefined }).block === false);
  const broken = { has: () => false, add: () => { throw new Error('disk full'); } };
  check('decide: a ledger that cannot record allows the read', decide({ ...read(big), ledger: broken }).block === false);
  const off = project('decide-off', 'workflow:\n  read_guard: false\n');
  check('decide: read_guard false passes', decide({ toolName: 'Read', toolInput: { file_path: path.join(off, 'big.txt') }, cwd: off, main: true, ledger: new Set() }).block === false);
  const sized = project('decide-sized', 'workflow:\n  read_guard_bytes: 1000000\n');
  check('decide: read_guard_bytes raises the threshold', decide({ toolName: 'Read', toolInput: { file_path: path.join(sized, 'big.txt') }, cwd: sized, main: true, ledger: new Set() }).block === false);
}

// Roles
{
  check('role: no markers is main', envSaysNotMain({}) === false);
  check('role: ACSTACK_AGENT_ROLE=main is main', envSaysNotMain({ ACSTACK_AGENT_ROLE: 'main' }) === false);
  check('role: ACSTACK_AGENT_ROLE=member is not main', envSaysNotMain({ ACSTACK_AGENT_ROLE: 'member' }) === true);
  check('role: AC_TEAMS_MEMBER is not main', envSaysNotMain({ AC_TEAMS_MEMBER: 'scout-1' }) === true);
}

// The ledger file
{
  const base = path.join(tmp, 'ledgers');
  fs.mkdirSync(base);
  const a = fileLedger('sess-a', base);
  a.add('k1');
  check('ledger: a recorded key is found by a fresh ledger', fileLedger('sess-a', base).has('k1'));
  check('ledger: sessions do not share entries', !fileLedger('sess-b', base).has('k1'));
  const dir = path.join(base, `acstack-read-guard-${process.getuid()}`);
  check('ledger: the folder is private', (fs.statSync(dir).mode & 0o777) === 0o700);
  check('ledger: one file per session', fs.existsSync(path.join(dir, 'sess-a.json')));
  check('ledger: no session id means no ledger', fileLedger(undefined, base) === undefined && fileLedger('', base) === undefined);
  fileLedger('../escape', base).add('k');
  check('ledger: an unsafe session id stays inside the folder', fs.readdirSync(base).length === 1 && !fs.existsSync(path.join(base, 'escape.json')));
  fs.chmodSync(dir, 0o777);
  let refused = false;
  try { fileLedger('sess-a', base).has('k1'); } catch { refused = true; }
  check('ledger: a folder others can write is refused', refused);
  fs.chmodSync(dir, 0o700);
}

// The hook, end to end
{
  const cwd = project('hook');
  const hook = path.join(root, 'hooks', 'read-guard.mjs');
  const env = { ...process.env, ACSTACK_AGENT_ROLE: '', AC_TEAMS_MEMBER: '' };
  const run = (input, extraEnv = {}) => spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...env, ...extraEnv } });
  const claude = { session_id: 'hook-claude', cwd, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(cwd, 'big.txt') } };
  const denied = run(claude);
  let output;
  try { output = JSON.parse(denied.stdout).hookSpecificOutput; } catch { output = undefined; }
  check('hook: Claude Code Read is denied with a reason', denied.status === 0 && output?.hookEventName === 'PreToolUse'
    && output?.permissionDecision === 'deny' && /repeat this exact read/.test(output?.permissionDecisionReason), denied.stdout + denied.stderr);
  const retry = run(claude);
  check('hook: the identical retry is allowed', retry.status === 0 && retry.stdout === '', retry.stdout);
  const codex = { session_id: 'hook-codex', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat big.txt' } };
  check('hook: Codex shell cat is denied', /"deny"/.test(run(codex).stdout));
  check('hook: a subagent (agent_id) is allowed', run({ ...claude, session_id: 'hook-sub', agent_id: 'a1', agent_type: 'Explore' }).stdout === '');
  check('hook: an ac-teams member is allowed', run({ ...claude, session_id: 'hook-member' }, { ACSTACK_AGENT_ROLE: 'member' }).stdout === '');
  const garbage = spawnSync('node', [hook], { input: 'not json', encoding: 'utf8', env });
  check('hook: bad input allows quietly', garbage.status === 0 && garbage.stdout === '');
}

fs.rmSync(tmp, { recursive: true, force: true });
