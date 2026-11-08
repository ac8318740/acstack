import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'acstack-codex-'));
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
let passed = 0;
let failed = 0;
let skipped = 0;
async function check(name, run) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: work,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...options,
});

async function nativePluginDetails(catalog, env) {
  const server = spawn('codex', ['app-server'], { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: server.stdout });
  let errors = '';
  server.stderr.on('data', (data) => { errors = (errors + data).slice(-8000); });
  server.on('error', (error) => { errors = error.message; lines.close(); });
  const timer = setTimeout(() => server.kill(), 30_000);
  const send = (message) => server.stdin.write(`${JSON.stringify(message)}\n`);
  try {
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'acstack-package-test', version: '1' },
      capabilities: { experimentalApi: true },
    } });
    for await (const line of lines) {
      const message = JSON.parse(line);
      if (message.id === 1) {
        assert.equal(message.error, undefined, JSON.stringify(message.error));
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'plugin/read', params: {
          pluginName: 'acstack', marketplacePath: path.join(catalog, '.agents/plugins/marketplace.json'),
        } });
      } else if (message.id === 2) {
        assert.equal(message.error, undefined, JSON.stringify(message.error));
        return message.result.plugin;
      }
    }
    throw new Error(`native plugin/read ended without a response: ${errors}`);
  } finally {
    clearTimeout(timer);
    lines.close();
    server.kill();
  }
}

try {
  const home = path.join(work, 'home');
  mkdirSync(path.join(home, '.codex'), { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    ACSTACK_HOME: path.join(work, 'acstack'),
    XDG_CONFIG_HOME: path.join(work, 'config'),
    XDG_DATA_HOME: path.join(work, 'share'),
  };
  const manifest = json(path.join(root, '.claude-plugin/plugin.json'));
  await check('shared native manifest identity and version match npm', () => {
    assert.equal(manifest.name, 'acstack');
    assert.equal(manifest.version, json(path.join(root, 'package.json')).version);
    assert.equal(existsSync(path.join(root, 'plugin.json')), false,
      'portable root manifest disables native Codex hooks');
  });

  const suppliedArchive = process.argv[2] && path.resolve(process.argv[2]);
  const pack = suppliedArchive ? null : JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work], { cwd: root, env }));
  const archive = suppliedArchive ?? path.join(work, pack[0].filename);
  const unpack = path.join(work, 'unpack');
  mkdirSync(unpack);
  run('tar', ['-xzf', archive, '-C', unpack]);
  const plugin = path.join(unpack, 'package');
  const packagedManifest = json(path.join(plugin, '.claude-plugin/plugin.json'));
  await check('npm tarball uses the shared manifest and includes generated Codex agents', () => {
    assert.equal(existsSync(path.join(plugin, 'plugin.json')), false,
      'portable root manifest disables native Codex hooks');
    assert.deepEqual(packagedManifest, manifest);
    assert.ok(existsSync(path.join(plugin, 'agents/codex/task-executor.toml')));
  });

  const hookEnv = { ...env, CLAUDE_PLUGIN_ROOT: plugin, PLUGIN_ROOT: plugin };
  const hooks = json(path.join(plugin, 'hooks/hooks.json')).hooks;
  await check('only orchestrator SessionStart disables native Codex context spilling', () => {
    const commands = hooks.SessionStart.flatMap((group) => group.hooks);
    const orchestrator = commands.filter((hook) => hook.command?.includes('/hooks/session-start.sh'));
    assert.equal(orchestrator.length, 1);
    assert.equal(orchestrator[0].additionalContextLimit, 0,
      'Codex must receive the full policy in initial context, without model-dependent recovery');
    for (const hook of commands.filter((hook) => hook !== orchestrator[0])) {
      assert.equal(hook.additionalContextLimit, undefined);
    }
  });
  await check('packaged SessionStart injects context, creates CLI link, and preserves user Codex agents', () => {
    run('git', ['init', '-q', work]);
    const agents = path.join(home, '.codex/agents');
    mkdirSync(agents, { recursive: true });
    const userAgent = path.join(agents, 'task-executor.toml');
    const custom = 'name = "task-executor"\ndescription = "My agent"\n';
    writeFileSync(userAgent, custom);
    const context = [];
    for (const group of hooks.SessionStart) {
      for (const hook of group.hooks) {
        const output = run('bash', ['-c', hook.command], { env: hookEnv, input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: work }), stdio: ['pipe', 'pipe', 'pipe'] });
        if (output.trim()) context.push(JSON.parse(output).hookSpecificOutput?.additionalContext ?? '');
      }
    }
    assert.ok(context.some((text) => text.includes('## Implementation discipline')));
    assert.ok(context.some((text) => text.includes('Use the fewest clear words')));
    assert.equal(readlinkSync(path.join(home, '.claude/acstack/bin/acstack')), path.join(plugin, 'cli/bin/acstack.js'));
    assert.equal(readFileSync(userAgent, 'utf8'), custom);
    for (const file of readdirSync(path.join(plugin, 'agents/codex'))) {
      if (!file.endsWith('.toml') || file === 'task-executor.toml') continue;
      assert.equal(readFileSync(path.join(agents, file), 'utf8'), readFileSync(path.join(plugin, 'agents/codex', file), 'utf8'));
    }
    rmSync(userAgent);
    // Reconciliation installs missing definitions and heals generated definitions on the next session.
    run('bash', [path.join(plugin, 'hooks/session-start.sh')], { env: hookEnv });
    const generated = readFileSync(userAgent, 'utf8');
    writeFileSync(userAgent, '# by scripts/gen-codex-agents.mjs\nstale = true\n');
    run('bash', [path.join(plugin, 'hooks/session-start.sh')], { env: hookEnv });
    assert.equal(readFileSync(userAgent, 'utf8'), generated);
  });

  await check('Codex agents honor custom CODEX_HOME without changing the default home', () => {
    const customHome = path.join(work, 'custom codex');
    const agents = path.join(customHome, 'agents');
    mkdirSync(agents, { recursive: true });
    const customAgent = path.join(agents, 'task-executor.toml');
    const custom = 'name = "task-executor"\ndescription = "Custom-home user agent"\n';
    writeFileSync(customAgent, custom);
    const defaultAgent = path.join(home, '.codex/agents/task-executor.toml');
    writeFileSync(defaultAgent, '# by scripts/gen-codex-agents.mjs\ndefault_home_sentinel = true\n');
    const customEnv = { ...hookEnv, CODEX_HOME: customHome };
    run('bash', [path.join(plugin, 'hooks/session-start.sh')], { env: customEnv });
    assert.equal(readFileSync(customAgent, 'utf8'), custom);
    for (const file of readdirSync(path.join(plugin, 'agents/codex'))) {
      if (!file.endsWith('.toml') || file === 'task-executor.toml') continue;
      assert.equal(readFileSync(path.join(agents, file), 'utf8'), readFileSync(path.join(plugin, 'agents/codex', file), 'utf8'));
    }
    assert.ok(readFileSync(defaultAgent, 'utf8').includes('default_home_sentinel'));
    writeFileSync(customAgent, '# by scripts/gen-codex-agents.mjs\nstale = true\n');
    run('bash', [path.join(plugin, 'hooks/session-start.sh')], { env: customEnv });
    assert.equal(readFileSync(customAgent, 'utf8'), readFileSync(path.join(plugin, 'agents/codex/task-executor.toml'), 'utf8'));
  });

  await check('Codex role setup retains unset-home fallback and no-config behavior', () => {
    const defaultEnv = { ...hookEnv };
    delete defaultEnv.CODEX_HOME;
    run('bash', [path.join(plugin, 'hooks/session-start.sh')], { env: defaultEnv });
    assert.equal(readFileSync(path.join(home, '.codex/agents/task-executor.toml'), 'utf8'),
      readFileSync(path.join(plugin, 'agents/codex/task-executor.toml'), 'utf8'));
    const missingHome = path.join(work, 'not-configured-codex');
    run('bash', [path.join(plugin, 'hooks/session-start.sh')], { env: { ...hookEnv, CODEX_HOME: missingHome } });
    assert.equal(existsSync(missingHome), false);
  });

  if (process.env.ACSTACK_TEST_CODEX !== '1') {
    skipped++;
    console.log('SKIP native Codex npm ingestion (set ACSTACK_TEST_CODEX=1; requires codex)');
  } else {
    await check('installed Codex parses npm catalog and discovers packaged SessionStart hooks', async () => {
      const catalog = path.join(work, 'catalog');
      mkdirSync(path.join(catalog, '.agents/plugins'), { recursive: true });
      writeFileSync(path.join(catalog, '.agents/plugins/marketplace.json'), JSON.stringify({
        name: 'acstack-npm-test',
        plugins: [{
          name: 'acstack',
          source: { source: 'npm', package: 'acstack', version: 'latest' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Productivity',
        }],
      }));
      const bin = path.join(work, 'bin');
      mkdirSync(bin);
      const log = path.join(work, 'npm-args.json');
      // Only transport is stubbed: Codex still parses the real npm source and unpacks the real tarball.
      writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}\n` +
        `const fs = require('node:fs'); const path = require('node:path');\n` +
        `fs.writeFileSync(process.env.ACSTACK_NPM_LOG, JSON.stringify(process.argv.slice(2)));\n` +
        `fs.copyFileSync(process.env.ACSTACK_NPM_ARCHIVE, path.join(process.cwd(), 'acstack.tgz'));\n`, { mode: 0o755 });
      const nativeEnv = { ...env, PATH: `${bin}${path.delimiter}${env.PATH}`, ACSTACK_NPM_LOG: log, ACSTACK_NPM_ARCHIVE: archive };
      run('codex', ['plugin', 'marketplace', 'add', catalog, '--json'], { env: nativeEnv });
      const result = JSON.parse(run('codex', ['plugin', 'add', 'acstack@acstack-npm-test', '--json'], { env: nativeEnv }));
      assert.equal(typeof result, 'object');
      const args = json(log);
      assert.equal(args[0], 'pack');
      assert.ok(args.includes('--ignore-scripts'));
      assert.equal(args.at(-1), 'acstack@latest');
      const listing = run('codex', ['plugin', 'list', '--marketplace', 'acstack-npm-test', '--json'], { env: nativeEnv });
      assert.ok(listing.includes('acstack@acstack-npm-test'), listing);
      const cache = path.join(home, '.codex/plugins/cache/acstack-npm-test/acstack');
      assert.ok(existsSync(cache), `missing installed cache ${cache}`);
      const installed = readdirSync(cache).map((entry) => path.join(cache, entry))
        .find((dir) => existsSync(path.join(dir, '.claude-plugin/plugin.json')));
      assert.ok(installed, 'native cache has no shared manifest');
      assert.deepEqual(json(path.join(installed, '.claude-plugin/plugin.json')), packagedManifest);
      assert.ok(existsSync(path.join(installed, 'hooks/hooks.json')));
      const details = await nativePluginDetails(catalog, nativeEnv);
      assert.equal(details.hooks.filter((hook) => hook.eventName === 'sessionStart').length,
        hooks.SessionStart.flatMap((group) => group.hooks).length,
        'native Codex must discover packaged SessionStart hooks');
      console.log(`Native parser: ${run('codex', ['--version'], { env: nativeEnv }).trim()}`);
    });
  }
} catch (error) {
  failed++;
  console.error(`FAIL setup: ${error.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Result: ${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exitCode = failed ? 1 : 0;
