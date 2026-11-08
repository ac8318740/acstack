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
  if (host === 'shell') {
    const policyStart = injected.indexOf('# ACStack: adaptive implementation and verification');
    const originalPolicy = fs.readFileSync(path.join(source, 'orchestrator/AGENTS.md'), 'utf8')
      .replace(/<!-- acstack:delegated:start -->[\s\S]*?<!-- acstack:delegated:end -->\n?/g, '')
      .replace(/<!-- acstack:lead:(start|end) -->\n?/g, '');
    check('shell: injection preserves the full lead policy and project-folder metadata unchanged',
      policyStart === 0 && injected === originalPolicy + "\n\nThis repository's ACStack project folder: " + folder + '\n');
  }
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

  // No setup: resolving a Git project must not require or create project.yaml.
  for (const existingFolder of [false, true]) {
    const fresh = path.join(work, `${host}-fresh-${existingFolder}`);
    fs.mkdirSync(fresh);
    execFileSync('git', ['init', '-q', fresh]);
    const freshFolder = execFileSync(process.execPath, [cli, 'project-data', 'path'], { cwd: fresh, encoding: 'utf8' }).trim();
    if (existingFolder) fs.mkdirSync(freshFolder, { recursive: true });
    notes.length = 0;
    const general = await start(fresh);
    const diagnostics = host === 'shell' ? stderr : notes.join('\n');
    check(`${host}: ${existingFolder ? 'empty project folder' : 'fresh Git'} loads general instructions`, general.includes('## Implementation discipline'));
    check(`${host}: no config startup does not mandate setup`, !diagnostics.includes('Run /acstack:setup to set up.'));
    check(`${host}: no config startup does not create config or repository files`,
      entries(fresh).join() === '.git' && !fs.existsSync(path.join(freshFolder, 'project.yaml'))
        && (existingFolder || !fs.existsSync(freshFolder)));
    const freshNested = path.join(fresh, 'src');
    fs.mkdirSync(freshNested);
    const nestedGeneral = await start(freshNested);
    check(`${host}: nested no-config directory loads the same general instructions`,
      nestedGeneral.includes('## Implementation discipline') && nestedGeneral.includes(freshFolder));
  }

  // A similarly named orphan is a warning, never a configuration or handoff source.
  const orphanRepo = path.join(work, `${host}-orphan`);
  fs.mkdirSync(orphanRepo);
  execFileSync('git', ['init', '-q', orphanRepo]);
  const orphanFolder = execFileSync(process.execPath, [cli, 'project-data', 'path'], { cwd: orphanRepo, encoding: 'utf8' }).trim();
  const orphan = orphanFolder.replace(/-[0-9a-f]{6}$/, orphanFolder.endsWith('-abcdef') ? '-fedcba' : '-abcdef');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, 'project.json'), JSON.stringify({ commonDir: path.join(work, 'missing-repository', '.git') }));
  fs.writeFileSync(path.join(orphan, 'HANDOFF.md'), handoffText);
  notes.length = 0;
  const orphanInjection = await start(orphanRepo);
  check(`${host}: orphan warning is nonblocking`, orphanInjection.includes('## Implementation discipline')
    && /project-data relink/.test(host === 'shell' ? stderr : notes.join('\n')));
  check(`${host}: orphan records are not adopted or consumed`, !(await compact(orphanRepo)).includes('Resume work')
    && fs.readFileSync(path.join(orphan, 'HANDOFF.md'), 'utf8') === handoffText && !fs.existsSync(orphanFolder));

  for (const error of ['conflict', 'broken-link']) {
    const invalid = path.join(work, `${host}-${error}`);
    fs.mkdirSync(invalid);
    execFileSync('git', ['init', '-q', invalid]);
    const invalidFolder = execFileSync(process.execPath, [cli, 'project-data', 'path'], { cwd: invalid, encoding: 'utf8' }).trim();
    fs.mkdirSync(path.dirname(invalidFolder), { recursive: true });
    let payload;
    if (error === 'conflict') {
      fs.mkdirSync(invalidFolder);
      fs.mkdirSync(path.join(invalid, '.acstack'));
      fs.writeFileSync(path.join(invalid, '.acstack/project.yaml'), 'profile: generic\n');
      execFileSync('git', ['add', '.acstack/project.yaml'], { cwd: invalid });
      payload = path.join(invalidFolder, 'HANDOFF.md');
      fs.writeFileSync(payload, handoffText);
    } else {
      fs.symlinkSync(path.join(invalid, '.acstack'), invalidFolder);
    }
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: invalid, encoding: 'utf8' });
    notes.length = 0;
    const rejected = await start(invalid);
    const diagnostic = host === 'shell' ? stderr : notes.join('\n');
    check(`${host}: ${error} is an explicit refusal, not absent setup`, rejected === ''
      && /project-data mode/.test(diagnostic) && !diagnostic.includes('no project config found'));
    check(`${host}: ${error} does not consume handoff or change project data`, !(await compact(invalid)).includes('Resume work')
      && before === execFileSync('git', ['status', '--porcelain'], { cwd: invalid, encoding: 'utf8' })
      && (payload ? fs.readFileSync(payload, 'utf8') === handoffText : fs.lstatSync(invalidFolder).isSymbolicLink()));
  }

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
