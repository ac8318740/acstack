import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = process.env.ACSTACK_TEST_WORK;
process.env.ACSTACK_REAL_CLI = path.join(source, 'cli/dist/index.js');
const plugin = path.join(work, 'plugin');
for (const dir of ['hooks', 'pi', 'orchestrator', 'output-styles']) {
  fs.cpSync(path.join(source, dir), path.join(plugin, dir), { recursive: true });
}
fs.mkdirSync(path.join(plugin, 'cli/bin'), { recursive: true });
fs.mkdirSync(path.join(plugin, 'cli/dist'), { recursive: true });
fs.copyFileSync(path.join(source, 'tests/fixtures/project-data-cli.mjs'), path.join(plugin, 'cli/bin/acstack.js'));
fs.chmodSync(path.join(plugin, 'cli/bin/acstack.js'), 0o755);
fs.writeFileSync(path.join(plugin, 'cli/dist/index.js'), '');
fs.writeFileSync(path.join(plugin, 'package.json'), '{"type":"module"}');
const extension = await import(path.join(plugin, 'pi/extension.ts'));
let failures = 0;
let passes = 0;
function check(name, cond) {
  console.log(`${cond ? 'ok' : 'not ok'} ${name}`);
  if (cond) passes++;
  else failures++;
}
for (const host of ['shell', 'pi']) {
  const project = path.join(work, host);
  fs.mkdirSync(path.join(project, '.acstack'), { recursive: true });
  execFileSync('git', ['init', '-q', project]);
  const exceptions = '!/.acstack/specs/\n!/.acstack/specs/**\n';
  fs.writeFileSync(path.join(project, '.gitignore'), exceptions);
  fs.mkdirSync(path.join(project, '.acstack/specs'));
  fs.writeFileSync(path.join(project, '.acstack/specs/spec.md'), 'shared');
  fs.writeFileSync(path.join(project, '.acstack/private.md'), 'private');
  const log = path.join(work, `${host}.calls`);
  process.env.ACSTACK_ENSURE_LOG = log;
  const notes = [];
  const handlers = {};
  extension.default({
    on: (name, fn) => { handlers[name] = fn; },
    registerCommand() {}, sendMessage() {}, getAllTools: () => [{ name: 'subagent' }],
  });
  const ctx = { cwd: project, hasUI: true, ui: { notify: (msg) => notes.push(msg) } };
  let stderr = '';
  async function start(cwd = project) {
    if (host === 'shell') {
      const result = spawnSync('bash', [path.join(plugin, 'hooks/session-start.sh')], {
        cwd, env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin }, encoding: 'utf8',
      });
      if (result.status !== 0) throw new Error(result.stderr);
      stderr = result.stderr;
      return result.stdout;
    }
    await handlers.session_start({ reason: 'startup' }, { ...ctx, cwd });
  }
  await start();
  check(`${host}: no config still invokes bundled ensure at the project root`,
    fs.existsSync(log) && fs.readFileSync(log, 'utf8').trim() === project);
  check(`${host}: private data is ignored`,
    execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: project, encoding: 'utf8' }).includes('private.md') === false);
  check(`${host}: native Git exceptions remain visible`,
    execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: project, encoding: 'utf8' }).includes('.acstack/specs/spec.md'));
  check(`${host}: exceptions are preserved`, fs.readFileSync(path.join(project, '.gitignore'), 'utf8').endsWith(exceptions));
  const first = fs.readFileSync(path.join(project, '.gitignore'), 'utf8');
  await start();
  check(`${host}: repeat startup is idempotent`, fs.readFileSync(path.join(project, '.gitignore'), 'utf8') === first);
  const nested = path.join(project, 'src');
  fs.mkdirSync(path.join(nested, 'acstack/src'), { recursive: true });
  await start(nested);
  check(`${host}: nested startup ignores authored acstack source and resolves empty .acstack`,
    fs.readFileSync(log, 'utf8').trim().split('\n').every((line) => line === project));
  fs.rmSync(path.join(project, '.git'), { recursive: true });
  await start(nested);
  check(`${host}: non-Git nested startup finds empty .acstack`,
    fs.readFileSync(log, 'utf8').trim().split('\n').at(-1) === project);
  const plain = path.join(work, `${host}-plain`);
  fs.mkdirSync(plain);
  await start(plain);
  check(`${host}: startup without project data does not create private state`,
    !fs.existsSync(path.join(plain, '.acstack')) && !fs.existsSync(path.join(plain, '.gitignore')));
  process.env.ACSTACK_ENSURE_FAIL = '1';
  fs.writeFileSync(path.join(project, '.acstack/project.yaml'), 'profile: generic\n');
  const out = await start();
  if (host === 'shell') {
    check(`${host}: failed ensure reports a warning`, /project-data ensure failed/.test(stderr));
    check(`${host}: failed ensure does not inject a ready orchestrator`, !out.includes('additionalContext'));
  } else {
    const event = { messageType: 'custom', systemPromptOptions: { sections: {} } };
    await handlers.before_agent_start(event, ctx);
    check(`${host}: failed ensure reports a warning`, notes.some((msg) => /project.data.*(failed|could not)|ignore.*(failed|not installed)/i.test(msg)));
    check(`${host}: failed ensure does not inject a ready orchestrator`, !event.systemPromptOptions.sections['acstack-orchestrator']);
  }
  const active = path.join(project, '.acstack/HANDOFF.md');
  fs.writeFileSync(active, '---\nacstack_handoff: 1\nmap: test\ncreated: 2026-01-01\n---\n\nResume work\n');
  if (host === 'shell') {
    const handoff = execFileSync('bash', [path.join(plugin, 'hooks/session-start-handoff.sh')], {
      cwd: project, input: '{"source":"compact"}', env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    check(`${host}: failed ensure does not inject handoff context`, handoff.trim() === '');
  } else {
    await handlers.session_compact({}, { ...ctx, sessionManager: { getSessionId: () => 'failure' } });
  }
  check(`${host}: failed ensure leaves the handoff untouched`, fs.existsSync(active) && !fs.existsSync(path.join(project, '.acstack/handoffs')));
  delete process.env.ACSTACK_ENSURE_FAIL;
  fs.mkdirSync(path.join(project, 'acstack'));
  fs.writeFileSync(path.join(project, 'acstack/project.yaml'), 'legacy: true\n');
  const mixed = await start();
  if (host === 'shell') {
    check(`${host}: mixed roots require explicit migration`, /project-data migrate/.test(stderr) && !mixed.includes('additionalContext'));
  } else {
    const event = { messageType: 'custom', systemPromptOptions: { sections: {} } };
    await handlers.before_agent_start(event, ctx);
    check(`${host}: mixed roots require explicit migration`, notes.some((msg) => msg.includes('project-data migrate')) && !event.systemPromptOptions.sections['acstack-orchestrator']);
  }
  for (const marker of ['project.yaml', 'maps']) {
    fs.rmSync(path.join(project, 'acstack'), { recursive: true, force: true });
    fs.mkdirSync(path.join(project, 'acstack'));
    fs.symlinkSync('../missing-target', path.join(project, 'acstack', marker));
    fs.rmSync(path.join(project, '.acstack/handoffs'), { recursive: true, force: true });
    fs.writeFileSync(active, '---\nacstack_handoff: 1\nmap: test\ncreated: 2026-01-01\n---\n\nResume work\n');
    notes.length = 0;
    const broken = await start();
    if (host === 'shell') {
      check(`${host}: broken ${marker} requires migration before activation`,
        /project-data migrate/.test(stderr) && !broken.includes('additionalContext'));
      const handoff = execFileSync('bash', [path.join(plugin, 'hooks/session-start-handoff.sh')], {
        cwd: project, input: '{"source":"compact"}', env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      check(`${host}: broken ${marker} does not inject handoff context`, handoff.trim() === '');
    } else {
      const event = { messageType: 'custom', systemPromptOptions: { sections: {} } };
      await handlers.before_agent_start(event, ctx);
      check(`${host}: broken ${marker} requires migration before activation`,
        notes.some(msg => msg.includes('project-data migrate')) && !event.systemPromptOptions.sections['acstack-orchestrator']);
      await handlers.session_compact({}, { ...ctx, sessionManager: { getSessionId: () => 'broken-link' } });
    }
    check(`${host}: broken ${marker} leaves the handoff untouched`,
      fs.existsSync(active) && !fs.existsSync(path.join(project, '.acstack/handoffs')));
  }
}
console.log(`Result: ${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
