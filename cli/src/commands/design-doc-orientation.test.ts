import { afterEach, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

// These exercise the shipped command; the completion owner rebuilds cli/dist before the final run.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const entry = fileURLToPath(new URL('../../../examples/design-doc/acstack/design.yaml', import.meta.url));
const roots: string[] = [];
const children: ChildProcess[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-orientation-'));
  roots.push(root);
  mkdirSync(join(root, '.acstack'));
  mkdirSync(join(root, 'empty-path'));
  writeFileSync(join(root, '.acstack/project.yaml'), 'name: orientation-test\n');
  return root;
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each([
  { args: [], orientation: 'top-to-bottom', direction: 'TD' },
  { args: ['--orientation', 'left-to-right'], orientation: 'left-to-right', direction: 'LR' },
])('serves $orientation HTML and Markdown through the shipped CLI', async ({ args, orientation, direction }) => {
  const root = fixture();
  // Never launch a browser or the user's acstack-open during fixture reviews.
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: join(root, 'empty-path') };
  delete env.SSH_CONNECTION;
  const child = spawn(process.execPath, [bin, 'design-doc', entry, '--port', '0', '--markdown', 'README.md', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  const deadline = Date.now() + 10_000;
  let url: string | undefined;
  while (Date.now() < deadline) {
    url = stripVTControlCharacters(output).match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s]*/)?.[0];
    if (url) break;
    if (child.exitCode !== null) throw new Error(`design-doc exited before serving: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!url) throw new Error(`design-doc did not print its live URL: ${output}`);
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(`"orientation":"${orientation}"`);
  expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain(`flowchart ${direction}`);
}, 15_000);

it('rejects invalid orientation before shipped CLI Markdown or lifecycle writes', () => {
  const root = fixture();
  const result = spawnSync(process.execPath, [bin, 'design-doc', entry, '--orientation', 'diagonal', '--markdown', 'README.md'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Allowed choices');
  // Startup repairs native ignore rules before Commander validates command options.
  expect(readdirSync(root).filter(name => name !== '.gitignore').sort()).toEqual(['.acstack', 'empty-path']);
  expect(readdirSync(join(root, '.acstack'))).toEqual(['project.yaml']);
});
