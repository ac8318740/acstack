import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Both hosts ask the real CLI for the project folder, then read and write only there.
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = process.env.ACSTACK_TEST_WORK;
const home = process.env.ACSTACK_HOME;
const plugin = path.join(work, 'plugin');
for (const dir of ['hooks', 'pi', 'orchestrator', 'output-styles']) {
  fs.cpSync(path.join(source, dir), path.join(plugin, dir), { recursive: true });
}
fs.mkdirSync(path.join(plugin, 'cli/bin'), { recursive: true });
fs.symlinkSync(path.join(source, 'cli/bin/acstack.js'), path.join(plugin, 'cli/bin/acstack.js'));
fs.writeFileSync(path.join(plugin, 'package.json'), '{"type":"module"}');
const extension = await import(path.join(plugin, 'pi/extension.ts'));
const cli = path.join(source, 'cli/bin/acstack.js');
let failures = 0;
let passes = 0;
function check(name, cond) {
  console.log(`${cond ? 'ok' : 'not ok'} ${name}`);
  if (cond) passes++;
  else failures++;
}
const handoffText = '---\nacstack_handoff: 1\nmap: test\ncreated: 2026-01-01\n---\n\nResume work\n';
const entries = (dir) => fs.readdirSync(dir).sort();

for (const host of ['shell', 'pi']) {
  const project = path.join(work, host);
  fs.mkdirSync(project);
  execFileSync('git', ['init', '-q', project]);
  const folder = execFileSync(process.execPath, [cli, 'project-data', 'path'], { cwd: project, encoding: 'utf8' }).trim();
  check(`${host}: the project folder sits under the ACStack home`, folder.startsWith(path.join(home, 'projects') + path.sep));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'project.yaml'), 'profile: generic\n');

  const notes = [];
  const handlers = {};
  extension.default({
    on: (name, fn) => { handlers[name] = fn; },
    registerCommand() {}, sendMessage: (message) => notes.push(message.content), getAllTools: () => [{ name: 'subagent' }],
  });
  const ctx = { cwd: project, hasUI: true, ui: { notify: (msg) => notes.push(msg) } };
  let stderr = '';
  /** Start a session in `cwd`; returns the orchestrator text it injected, or ''. */
  async function start(cwd = project) {
    if (host === 'shell') {
      const result = spawnSync('bash', [path.join(plugin, 'hooks/session-start.sh')], {
        cwd, env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin }, encoding: 'utf8',
      });
      if (result.status !== 0) throw new Error(result.stderr);
      stderr = result.stderr;
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? '' : '';
    }
    await handlers.session_start({ reason: 'startup' }, { ...ctx, cwd });
    const event = { messageType: 'custom', systemPromptOptions: { sections: {} } };
    await handlers.before_agent_start(event, { ...ctx, cwd });
    return event.systemPromptOptions.sections['acstack-orchestrator'] ?? '';
  }
  async function compact(cwd = project) {
    if (host === 'shell') {
      return execFileSync('bash', [path.join(plugin, 'hooks/session-start-handoff.sh')], {
        cwd, input: '{"source":"compact"}', env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    const before = notes.length;
    await handlers.session_compact({}, { ...ctx, cwd, sessionManager: { getSessionId: () => host } });
    return notes.slice(before).join('\n');
  }

  const injected = await start();
  check(`${host}: a set-up project injects the orchestrator`, injected.includes('/acstack:compact-and-continue'));
  check(`${host}: the injection names the project folder`, injected.includes(folder));
  check(`${host}: the lead session gets the lead role`, !injected.includes('You are a delegated session') && !injected.includes('<!-- acstack:'));
  check(`${host}: startup leaves the repository untouched`, entries(project).join() === '.git');

  const nested = path.join(project, 'src');
  fs.mkdirSync(nested);
  check(`${host}: a nested directory finds the same project`, (await start(nested)).includes(folder));

  fs.writeFileSync(path.join(folder, 'HANDOFF.md'), handoffText);
  const resumed = await compact(nested);
  check(`${host}: compaction injects the handoff from the project folder`, resumed.includes('Resume work'));
  check(`${host}: the handoff is archived in the project folder`, !fs.existsSync(path.join(folder, 'HANDOFF.md')) && fs.existsSync(path.join(folder, 'handoffs/test')));

  const plain = path.join(work, `${host}-plain`);
  fs.mkdirSync(plain);
  check(`${host}: outside Git there is no project`, (await start(plain)) === '');
  check(`${host}: outside Git nothing is created`, entries(plain).length === 0);

  const legacy = path.join(work, `${host}-legacy`);
  fs.mkdirSync(path.join(legacy, '.acstack'), { recursive: true });
  execFileSync('git', ['init', '-q', legacy]);
  fs.writeFileSync(path.join(legacy, '.acstack/project.yaml'), 'profile: generic\n');
  fs.writeFileSync(path.join(legacy, '.acstack/HANDOFF.md'), handoffText);
  notes.length = 0;
  const refused = await start(legacy);
  const warning = host === 'shell' ? stderr : notes.join('\n');
  check(`${host}: legacy repository data names project-data migrate`, /project-data migrate/.test(warning));
  check(`${host}: legacy repository data does not activate the orchestrator`, refused === '');
  check(`${host}: legacy repository data does not inject its handoff`, !(await compact(legacy)).includes('Resume work'));
  check(`${host}: legacy repository data stays where it was`, fs.existsSync(path.join(legacy, '.acstack/HANDOFF.md')) && !fs.existsSync(path.join(home, 'projects', path.basename(legacy))));
}
console.log(`Result: ${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
