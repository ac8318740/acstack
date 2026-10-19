// Drives pi/extension.ts through a stub pi API. Run by tests/test-pi-extension.sh,
// which sets HOME, TMPDIR and the PATH this script expects.
//
// Prints one "ok <name>" or "not ok <name>: <detail>" line per check.

import * as fs from 'node:fs';
import * as path from 'node:path';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = process.env.ACSTACK_TEST_WORK;
const home = process.env.HOME;
const ext = await import(path.join(root, 'pi', 'extension.ts'));

function check(name, cond, detail = '') {
  console.log(cond ? `ok ${name}` : `not ok ${name}${detail ? `: ${detail}` : ''}`);
}

/** Load the extension against a fresh stub, and return its registrations. */
function load({ tools = ['subagent'] } = {}) {
  const handlers = {};
  const commands = {};
  const sent = [];
  const userSent = [];
  const pi = {
    on: (event, fn) => { (handlers[event] ??= []).push(fn); return () => {}; },
    registerCommand: (name, opts) => { commands[name] = opts; },
    getAllTools: () => tools.map((name) => ({ name })),
    sendMessage: (message, options) => { sent.push({ message, options }); },
    sendUserMessage: (content, options) => { userSent.push({ content, options }); },
  };
  ext.default(pi);
  return { handlers, commands, sent, userSent };
}

function makeCtx(cwd, { tokens = null, contextWindow = 1000000, sessionId = 'sess-1' } = {}) {
  const notes = [];
  return {
    notes,
    cwd,
    hasUI: true,
    isIdle: () => true,
    ui: { notify: (msg, level) => notes.push({ msg, level }) },
    getContextUsage: () => ({ tokens, contextWindow, percent: null }),
    sessionManager: { getSessionId: () => sessionId },
  };
}

async function fire(reg, event, payload, ctx) {
  let result;
  for (const fn of reg.handlers[event] ?? []) result = (await fn(payload, ctx)) ?? result;
  return result;
}

function newProject(name, { acstack = true } = {}) {
  const dir = path.join(work, name);
  fs.mkdirSync(path.join(dir, '.acstack'), { recursive: true });
  if (acstack) fs.writeFileSync(path.join(dir, '.acstack', 'project.yaml'), 'profile: generic\n');
  return dir;
}

function promptEvent() {
  return { type: 'before_agent_start', messageType: 'user', prompt: 'hi', images: [], systemPrompt: '', systemPromptOptions: { sections: {} } };
}

function customEvent() {
  return { type: 'before_agent_start', messageType: 'custom', message: { customType: 'test', content: 'hi' }, systemPrompt: '', systemPromptOptions: { sections: {} } };
}

const wrapper = path.join(root, 'cli', 'bin', 'acstack.js');
const agentLink = path.join(home, '.claude', 'acstack', 'bin', 'acstack');
const humanLink = path.join(home, '.local', 'bin', 'acstack');

// --- session_start: CLI symlinks ---------------------------------------------

{
  const reg = load();
  const ctx = makeCtx(newProject('links'));
  const realExecFileSync = childProcess.execFileSync;
  let ensureCall;
  childProcess.execFileSync = (file, args, options) => {
    if (file === wrapper || args?.includes(wrapper)) {
      ensureCall = { file, args, options };
      // Native Windows cannot execute a JavaScript shebang directly.
      if (file === wrapper) throw new Error('spawnSync acstack.js EINVAL');
    }
    return realExecFileSync(file, args, options);
  };
  syncBuiltinESMExports();
  try {
    await fire(reg, 'session_start', { reason: 'startup' }, ctx);
  } finally {
    childProcess.execFileSync = realExecFileSync;
    syncBuiltinESMExports();
  }
  check('startup runs the real ensure CLI through Node',
    ensureCall?.file === process.execPath
      && JSON.stringify(ensureCall.args) === JSON.stringify([wrapper, 'project-data', 'ensure'])
      && ensureCall.options.cwd === ctx.cwd
      && fs.existsSync(path.join(ctx.cwd, '.gitignore'))
      && !ctx.notes.some(n => n.msg.includes('project-data ensure failed')));
  check('creates the agent CLI symlink', fs.readlinkSync(agentLink) === wrapper);
  check('creates the human CLI symlink', fs.readlinkSync(humanLink) === wrapper);

  fs.rmSync(agentLink);
  fs.symlinkSync('/nowhere/old-cache/acstack.js', agentLink);
  await fire(reg, 'session_start', { reason: 'startup' }, ctx);
  check('retargets a stale symlink', fs.readlinkSync(agentLink) === wrapper);
  check('retargets a stale symlink without a notification', !ctx.notes.some((n) => n.msg.includes('updated agent CLI')));

  fs.rmSync(humanLink);
  fs.writeFileSync(humanLink, '#!/bin/sh\n');
  await fire(reg, 'session_start', { reason: 'startup' }, ctx);
  check('leaves a real file alone', !fs.lstatSync(humanLink).isSymbolicLink());
  check('warns about the real file', ctx.notes.some((n) => n.level === 'warning' && n.msg.includes('not a symlink')));
  fs.rmSync(humanLink);
}

// --- session_start: pi-subagents and the setup reminder ----------------------

{
  const reg = load({ tools: ['read', 'bash'] });
  const ctx = makeCtx(newProject('no-subagents'));
  await fire(reg, 'session_start', { reason: 'startup' }, ctx);
  await fire(reg, 'session_start', { reason: 'new' }, ctx);
  const warnings = ctx.notes.filter((n) => n.msg.includes('pi-subagents is not loaded'));
  check('warns once when pi-subagents is missing', warnings.length === 1, `${warnings.length} warnings`);

  const reg2 = load();
  const ctx2 = makeCtx(newProject('with-subagents'));
  await fire(reg2, 'session_start', { reason: 'startup' }, ctx2);
  check('stays quiet when pi-subagents is loaded', !ctx2.notes.some((n) => n.msg.includes('pi-subagents')));
  check('no setup reminder inside an acstack project', !ctx2.notes.some((n) => n.msg.includes('no project config')));

  const ctx3 = makeCtx(newProject('plain', { acstack: false }));
  await fire(reg2, 'session_start', { reason: 'startup' }, ctx3);
  check('setup reminder outside an acstack project', ctx3.notes.some((n) => n.msg.includes('no project config found')));

  const ctx4 = makeCtx(newProject('plain-new', { acstack: false }));
  await fire(reg2, 'session_start', { reason: 'new' }, ctx4);
  check('setup reminder only on startup', !ctx4.notes.some((n) => n.msg.includes('no project config')));
}

// --- before_agent_start: orchestrator ------------------------------------------

{
  const reg = load();
  const orchestrator = fs.readFileSync(path.join(root, 'orchestrator', 'AGENTS.md'), 'utf-8');

  const event = promptEvent();
  await fire(reg, 'before_agent_start', event, makeCtx(newProject('orch')));
  check('injects orchestrator/AGENTS.md in an acstack project',
    event.systemPromptOptions.sections['acstack-orchestrator'] === orchestrator);

  const plain = promptEvent();
  await fire(reg, 'before_agent_start', plain, makeCtx(newProject('orch-plain', { acstack: false })));
  check('no orchestrator outside an acstack project', !('acstack-orchestrator' in plain.systemPromptOptions.sections));
  check('section names are valid pi section names',
    Object.keys(event.systemPromptOptions.sections).every((n) => /^[a-z][a-z0-9_-]*$/.test(n)));
}

// --- before_agent_start: the skills listing ------------------------------------

{
  // ACStack's skills are not pi skills, so pi registers no /skill:<name>
  // command for them. The extension lists them in the prompt instead.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
  check('package.json gives pi no skills', !('skills' in manifest.pi));

  const reg = load();
  const event = promptEvent();
  await fire(reg, 'before_agent_start', event, makeCtx(newProject('skills-plain', { acstack: false })));
  const listing = event.systemPromptOptions.sections['acstack-skills'] ?? '';
  const mapFile = path.join(root, 'skills', 'map', 'SKILL.md');
  check('lists the skills in every session, with name and absolute path',
    listing.includes(`    <name>map</name>`) && listing.includes(`    <location>${mapFile}</location>`));
  check('lists a skill with its description',
    /<name>test-conventions<\/name>\n    <description>Test placement rules[^<]*<\/description>/.test(listing));
  check('leaves out a skill only the user may run', listing.includes('<name>implement</name>') && !listing.includes('<name>setup</name>'));
  check('tells the model to name skills as /acstack:<name>', listing.includes('write /acstack:<name>, never /skill:<name>'));
  check('still registers /acstack:setup', reg.commands['acstack:setup'] !== undefined);
}

// --- writing style --------------------------------------------------------------

{
  const reg = load();
  const ctx = makeCtx(newProject('style'));
  const settings = path.join(home, '.pi', 'agent', 'acstack.json');

  const on = promptEvent();
  const onResult = await fire(reg, 'before_agent_start', on, ctx);
  const style = on.systemPromptOptions.sections['acstack-writing-style'] ?? '';
  check('adds the default style to the system prompt without its frontmatter',
    style.startsWith('# ac writing style') && style.includes('## Before you send'));
  const shared = style.split('<!-- acstack:communication:start -->\n')[1]?.split('<!-- acstack:communication:end -->')[0];
  check('the complete canonical block rides along as a hidden message for user turns',
    onResult?.message?.customType === 'acstack-writing-style-reminder' && onResult.message.display === false
      && shared?.trim() && onResult.message.content === `ac-writing-style reminder\n\n${shared}`);

  const custom = customEvent();
  const customResult = await fire(reg, 'before_agent_start', custom, ctx);
  check('custom-triggered turns get the style without the reminder',
    custom.systemPromptOptions.sections['acstack-writing-style'] === style && customResult === undefined);

  check('an unterminated shared block produces no reminder',
    ext.extractWritingReminder('<!-- acstack:communication:start -->\nPartial guidance\n') === undefined);
  check('an empty shared block produces no reminder',
    ext.extractWritingReminder('<!-- acstack:communication:start -->\n\n<!-- acstack:communication:end -->') === undefined);

  // The reminder must match what the Claude hook emits from the same file.
  const hookHome = path.join(work, 'hook-home');
  fs.mkdirSync(path.join(hookHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(hookHome, '.claude', 'settings.json'), '{"outputStyle": "acstack:ac-writing-style"}\n');
  const hookOut = execFileSync('bash', [path.join(root, 'hooks', 'ac-writing-style-reminder.sh')], {
    cwd: work, input: '', env: { ...process.env, HOME: hookHome, CLAUDE_PLUGIN_ROOT: root },
  }).toString();
  const hookContext = JSON.parse(hookOut).hookSpecificOutput.additionalContext;
  check('the default reminder matches hooks/ac-writing-style-reminder.sh', onResult?.message?.content === hookContext);

  await reg.commands['acstack-writing-style'].handler('off', ctx);
  const off = promptEvent();
  const offResult = await fire(reg, 'before_agent_start', off, ctx);
  check('the writing style command can turn injection off',
    !off.systemPromptOptions.sections['acstack-writing-style'] && offResult === undefined);

  const customFile = path.join(ctx.cwd, 'custom-writing-style.md');
  fs.writeFileSync(customFile, `---\nname: mine\n---\n# custom style\n\n## Who you are\n\n### Custom persona\n\n- Write like me\n\n## Shape: Minto pyramid\n\n## Before you send\n\n1. Check the custom style\n`);
  await reg.commands['acstack-writing-style'].handler('custom ./custom-writing-style.md', ctx);
  const customStyleEvent = promptEvent();
  const customStyleResult = await fire(reg, 'before_agent_start', customStyleEvent, ctx);
  const customStyle = customStyleEvent.systemPromptOptions.sections['acstack-writing-style'] ?? '';
  check('the writing style command can use a user-owned custom file',
    customStyle.startsWith('# custom style') && customStyle.includes('Check the custom style'));
  check('the custom style reminder comes from the custom file',
    customStyleResult?.message?.content.includes('Custom persona') && customStyleResult.message.content.includes('Check the custom style'));
  check('the custom style path is persisted outside the package as an absolute path',
    JSON.parse(fs.readFileSync(settings, 'utf-8')).writingStyle.path === customFile);

  await reg.commands['acstack-writing-style'].handler('default', ctx);
  const defaultAgain = promptEvent();
  await fire(reg, 'before_agent_start', defaultAgain, ctx);
  check('the writing style command can return to the bundled default',
    defaultAgain.systemPromptOptions.sections['acstack-writing-style'] === style);
}

// --- context pressure -----------------------------------------------------------

{
  const reg = load();
  const dir = newProject('pressure');
  const settle = (tokens, sessionId = 'press-1') =>
    fire(reg, 'agent_before_settle', { type: 'agent_before_settle', outcome: 'completed', entries: [], continue: false },
      makeCtx(dir, { tokens, sessionId }));

  check('no nudge below the warn mark', (await settle(150000)) === undefined);
  const warn = await settle(250000);
  const warnContent = warn?.entries[0]?.content ?? '';
  check('nudges past the warn mark and continues the run',
    warn?.continue === true && warnContent.startsWith('Context check: this session has used about 250,000'));
  check('warn nudge frames high context as continuity versus freshness',
    /continuity/i.test(warnContent) && /freshness/i.test(warnContent));
  check('warn continuity route says useful working context means continue in the same session',
    /working context/i.test(warnContent) && /(same session|this session)/i.test(warnContent));
  check('warn freshness route names /acstack:handoff',
    warnContent.includes('/acstack:handoff'));
  check('warn nudge outside herdr does not default to compact-and-continue',
    !/compact-and-continue/i.test(warnContent));
  check('warn nudge gives the agent the call', /the call is yours/i.test(warnContent));
  check('warn nudge lets a strong view act unasked', /act on it without asking/i.test(warnContent));
  check('warn nudge makes the ask conditional', /if you don't know/i.test(warnContent));
  check('warn nudge never orders an unconditional ask',
    !/ask the user first|do not decide that alone|let them choose/i.test(warnContent));
  check('does not repeat the same rung', (await settle(260000)) === undefined);
  check('no nudge between the warn and severe marks', (await settle(450000)) === undefined);
  const severe = await settle(520000);
  const severeContent = severe?.entries[0]?.content ?? '';
  check('severe wording past the severe mark', severeContent.startsWith('Context check (urgent)'));
  check('severe nudge keeps the continuity versus freshness checkpoint',
    /continuity/i.test(severeContent) && /freshness/i.test(severeContent));
  check('severe freshness route names /acstack:handoff',
    severeContent.includes('/acstack:handoff'));
  check('severe nudge gives the agent the call', /the call is yours/i.test(severeContent));
  check('severe nudge lets a strong view act unasked', /act on it without asking/i.test(severeContent));
  check('severe nudge makes the ask conditional', /if you don't know/i.test(severeContent));
  check('severe nudge never orders an unconditional ask',
    !/ask the user first|do not decide that alone|let them choose/i.test(severeContent));
  const ladder = await settle(610000);
  const ladderContent = ladder?.entries[0]?.content ?? '';
  check('fires again one step above the last rung', ladderContent.includes('past the 600,000 severe mark'));
  check('ladder nudge still presents continuity and freshness routes',
    /continuity/i.test(ladderContent) && /freshness/i.test(ladderContent) && ladderContent.includes('/acstack:handoff'));
  check('ladder nudge gives the agent the call', /the call is yours/i.test(ladderContent));
  check('ladder nudge lets a strong view act unasked', /act on it without asking/i.test(ladderContent));
  check('ladder nudge makes the ask conditional', /if you don't know/i.test(ladderContent));
  check('ladder nudge never orders an unconditional ask',
    !/ask the user first|do not decide that alone|let them choose/i.test(ladderContent));

  const stateDir = path.join(process.env.TMPDIR, 'acstack-context-pressure');
  fs.writeFileSync(path.join(stateDir, 'press-2.quiet'), '');
  check('the quiet marker silences the nudge', (await settle(900000, 'press-2')) === undefined);

  await fire(reg, 'session_compact', { type: 'session_compact' }, makeCtx(dir, { sessionId: 'press-1' }));
  check('a compaction restarts the ladder', (await settle(250000))?.continue === true);

  fs.writeFileSync(path.join(dir, '.acstack', 'project.yaml'),
    'workflow:\n  handoff:\n    context_thresholds:\n      - "10%"\n    nudge_step: 0\n');
  const pct = await fire(reg, 'agent_before_settle', { outcome: 'completed' },
    makeCtx(dir, { tokens: 120000, contextWindow: 1000000, sessionId: 'press-3' }));
  check('a percentage rung resolves against the reported window', pct?.entries[0].content.includes('past the 100,000'));

  // pi compacts about 16k short of the window, so the default marks drop
  // below a small window.
  const small = newProject('pressure-small');
  const settleSmall = (tokens) => fire(reg, 'agent_before_settle', { outcome: 'completed' },
    makeCtx(small, { tokens, contextWindow: 200000, sessionId: 'press-small' }));
  check('the default warn mark caps at half a small window',
    (await settleSmall(120000))?.entries[0].content.includes('past the 100,000 mark'));
  check('the default severe mark caps at 80% of a small window',
    (await settleSmall(170000))?.entries[0].content.includes('past the 160,000 severe mark'));

  check('reads flow-style thresholds',
    JSON.stringify(ext.readHandoffConfig('workflow:\n  handoff:\n    context_thresholds: [40%, 600000]\n').context_thresholds)
      === '["40%","600000"]');
}

// --- context pressure: parity with the Claude hook ------------------------------

{
  // The same tokens and project.yaml through hooks/context-pressure.sh and
  // through the extension must produce the same nudge.
  const reg = load();
  const dir = newProject('pressure-parity');
  fs.writeFileSync(path.join(dir, '.acstack', 'project.yaml'),
    'workflow:\n  handoff:\n    context_window: 400000\n    nudge_severe: 300000\n' +
    '    context_thresholds:\n      - "50%"\n      - "75%"\n');
  const hookState = path.join(work, 'hook-pressure');

  const hookReason = (tokens, sessionId) => {
    const transcript = path.join(work, `${sessionId}.jsonl`);
    const usage = { input_tokens: tokens - 1000, cache_read_input_tokens: 600, cache_creation_input_tokens: 400 };
    fs.writeFileSync(transcript,
      `${JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', usage } })}\n`);
    const out = execFileSync('bash', [path.join(root, 'hooks', 'context-pressure.sh')], {
      cwd: dir,
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId, transcript_path: transcript }),
      env: { ...process.env, ACSTACK_CONTEXT_PRESSURE_DIR: hookState },
    }).toString();
    return out.trim() ? JSON.parse(out).reason : undefined;
  };
  const piReason = async (tokens, sessionId) =>
    (await fire(reg, 'agent_before_settle', { outcome: 'completed' },
      makeCtx(dir, { tokens, contextWindow: 1000000, sessionId })))?.entries[0].content;

  const warnHook = hookReason(210000, 'parity-warn');
  const warnPi = await piReason(210000, 'parity-warn');
  check('the warn nudge matches hooks/context-pressure.sh',
    warnHook !== undefined && warnHook === warnPi && warnHook.startsWith('Context check: '), `hook: ${warnHook}\npi:   ${warnPi}`);

  const severeHook = hookReason(310000, 'parity-severe');
  const severePi = await piReason(310000, 'parity-severe');
  check('the severe nudge matches hooks/context-pressure.sh',
    severeHook !== undefined && severeHook === severePi && severeHook.startsWith('Context check (urgent)'), `hook: ${severeHook}\npi:   ${severePi}`);
}

// --- handoff reload ---------------------------------------------------------------

{
  const reg = load();
  const dir = newProject('handoff');
  const active = path.join(dir, '.acstack', 'HANDOFF.md');
  fs.writeFileSync(active, '---\nacstack_handoff: 1\nmap: my map\ncreated: 2026-10-11T04:00:00Z\n---\n\n## Next action\nShip it\n');

  await fire(reg, 'session_compact', { type: 'session_compact' }, makeCtx(dir));
  const archived = path.join(dir, '.acstack', 'handoffs', 'my-map', '2026-10-11T04-00-00Z.md');
  check('moves the handoff into the archive', !fs.existsSync(active) && fs.existsSync(archived));
  const msg = reg.sent[0];
  check('injects the handoff on the next turn',
    msg?.options?.deliverAs === 'nextTurn' && msg.message.content.includes('## Next action\nShip it'));

  // The message must match what the Claude hook injects from the same file.
  const parity = newProject('handoff-parity');
  const parityFile = path.join(parity, '.acstack', 'HANDOFF.md');
  const anchor = '---\nacstack_handoff: 1\nmap: parity\ncreated: 2026-10-11T05:00:00Z\n---\n\n## Next action\nShip it\n';
  fs.writeFileSync(parityFile, anchor);
  const hookOut = execFileSync('bash', [path.join(root, 'hooks', 'session-start-handoff.sh')], {
    cwd: parity, input: '{"source":"compact"}',
  }).toString();
  const hookContext = JSON.parse(hookOut).hookSpecificOutput.additionalContext;
  fs.writeFileSync(parityFile, anchor);
  check('the handoff message matches hooks/session-start-handoff.sh', ext.consumeHandoff(parity) === hookContext);

  fs.writeFileSync(active, '# my own notes\n');
  await fire(reg, 'session_compact', { type: 'session_compact' }, makeCtx(dir));
  check('leaves a HANDOFF.md without the marker alone', fs.existsSync(active) && reg.sent.length === 1);
}

// --- skill commands ----------------------------------------------------------------

{
  const reg = load();
  const ctx = makeCtx(newProject('skills'));
  const skillDirs = fs.readdirSync(path.join(root, 'skills')).filter((d) => fs.existsSync(path.join(root, 'skills', d, 'SKILL.md')));
  check('registers /acstack:<name> for every skill',
    skillDirs.every((d) => reg.commands[`acstack:${d}`]) && reg.commands.acstack !== undefined);

  await reg.commands.acstack.handler('map chart the auth rewrite', ctx);
  const mapFile = path.join(root, 'skills', 'map', 'SKILL.md');
  const sentMap = reg.userSent[0]?.content ?? '';
  check('/acstack map sends the ACStack map skill with the arguments',
    sentMap.startsWith(`<skill name="map" location="${mapFile}">`) && sentMap.endsWith('</skill>\n\nchart the auth rewrite'));

  await reg.commands['acstack:commit'].handler('', ctx);
  check('/acstack:commit sends the commit skill', reg.userSent[1]?.content.startsWith('<skill name="commit"'));

  await reg.commands.acstack.handler('nope', ctx);
  check('an unknown skill warns and sends nothing',
    reg.userSent.length === 2 && ctx.notes.some((n) => n.msg.includes('no skill named "nope"')));
}

// --- subagent children ----------------------------------------------------------

{
  process.env.PI_SUBAGENT_CHILD = '1';
  const reg = load();
  delete process.env.PI_SUBAGENT_CHILD;
  check('registers nothing inside a pi-subagents child',
    Object.keys(reg.handlers).length === 0 && Object.keys(reg.commands).length === 0);

  process.env.PI_SUBAGENTS_HERDR_BRIDGE = '1';
  const placed = load();
  delete process.env.PI_SUBAGENTS_HERDR_BRIDGE;
  check('registers nothing inside a herdr-placed pi-subagents child',
    Object.keys(placed.handlers).length === 0 && Object.keys(placed.commands).length === 0);
}
