import { afterEach, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { gitBinary, trackProject } from '../test-project.js';

// Black-box contract test of element examples through the shipped CLI; the parent rebuilds cli/dist first.
const bin = fileURLToPath(new URL('../../bin/acstack.js', import.meta.url));
const roots: string[] = [];
const children: ChildProcess[] = [];
type Tuple = { sourceRevision: string; reviewRevision: number; commentsDigest: string; mapInputsDigest: string };
type Status = Tuple & { locked: string[]; warnings: string[]; blockers: Record<string, string>[]; approval: { valid: boolean; reason?: string } };

const element = (yaml: string) => `<details>\n<summary>Design element</summary>\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n</details>`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-examples-'));
  roots.push(root);
  const map = join(root, '.acstack/maps/demo');
  mkdirSync(join(map, 'elements/102'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, '.acstack/project.yaml'), 'name: examples-test\nworkflow:\n  maps:\n    tracker: files\n');
  const node = (id: string, kind: string, body = '', answers = '101') => writeFileSync(join(map, `${id}-node.md`), `---\nstatus: open\nmode: hitl\nkind: ${kind}\nlabel: Node ${id}\n${kind === 'destination' ? '' : `answers: "${answers}"\n`}blocked-by: []\n---\n\n# Node ${id}\n\n${body}\n`);
  node('101', 'destination');
  node('102', 'element', element('kind: component\nconnections: [{to: 103, direction: one-way, label: Writes}]\nexamples:\n  - {title: Checkout, od: {design: checkout, page: home}}\n  - {fixture: order.json, schema: order.schema.json}'));
  node('103', 'element', element('kind: store'));
  writeFileSync(join(map, 'elements/102/order.json'), '{"id": 1}');
  writeFileSync(join(map, 'elements/102/order.schema.json'), '{"type": "object", "required": ["id"]}');
  mkdirSync(join(root, '.open-designer/designs/checkout'), { recursive: true });
  writeFileSync(join(root, '.open-designer/designs/checkout/index.json'), JSON.stringify({ pages: [{ id: 'home', variants: [{ id: 'grid', file: 'grid.tsx' }, { id: 'list', file: 'list.tsx' }] }] }));
  trackProject(root);
  symlinkSync(gitBinary, join(root, 'bin', 'git'));
  // A real subprocess stands in for OpenDesigner's CLI and its documented JSON stdout.
  const built = join(root, 'built.html');
  writeFileSync(built, `<meta name="od-variant" content="grid">\n<script type="application/json" id="od-page">${JSON.stringify({ page: { tweaks: [] }, designTweaks: [], variants: [{ id: 'grid', tweaks: [] }, { id: 'list', tweaks: [] }] })}</script>`);
  writeFileSync(join(root, 'bin/open-designer'), `#!${process.execPath}\nconsole.log(JSON.stringify({ path: ${JSON.stringify(built)}, size: 10, design: 'checkout', page: 'home', variant: 'grid', variants: ['grid', 'list'] }));\n`);
  chmodSync(join(root, 'bin/open-designer'), 0o755);
  return root;
}
function env(root: string): NodeJS.ProcessEnv {
  const value: NodeJS.ProcessEnv = { ...process.env, PATH: join(root, 'bin'), HOME: root, XDG_CONFIG_HOME: root, NO_COLOR: '1' };
  delete value.SSH_CONNECTION;
  return value;
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  })));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const request = (url: URL | string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...init.headers as Record<string, string>, Connection: 'close' }, signal: AbortSignal.timeout(10_000) });

async function start(root: string) {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, [bin, 'design-doc', 'demo', '--port', String(port)], { cwd: root, env: env(root), stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  let url = '';
  for (const deadline = Date.now() + 10_000; !url && Date.now() < deadline;) {
    url = stripVTControlCharacters(output).match(/http:\/\/localhost:\d+\//)?.[0] ?? '';
    if (child.exitCode !== null) throw new Error(`design-doc exited: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!url) throw new Error(`No review URL: ${output}`);
  const html = await (await request(url)).text();
  const token = /name="acstack-review-token" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const headers = { 'x-review-token': token, 'content-type': 'application/json', origin: new URL(url).origin };
  const api = new URL('/api/design-review', url);
  const status = async () => await (await request(api, { headers })).json() as Status;
  const tuple = ({ sourceRevision, reviewRevision, commentsDigest, mapInputsDigest }: Tuple) => ({ sourceRevision, reviewRevision, commentsDigest, mapInputsDigest });
  return {
    html, url, headers, status, output: () => output,
    lock: async (id: string, capture?: unknown) => request(api, { method: 'POST', headers, body: JSON.stringify({ lock: id, ...(capture !== undefined && { capture }), expected: tuple(await status()) }) }),
    example: (path: string, token_ = token) => request(new URL(`/api/examples?element=102&path=${encodeURIComponent(path)}`, url), { headers: { 'x-review-token': token_ } }),
  };
}

it('lists examples in the page, serves their content behind the token, and holds approval until a variant is chosen', async () => {
  const root = fixture();
  const check = spawnSync(process.execPath, [bin, 'design-doc', 'demo', '--check'], { cwd: root, env: env(root), encoding: 'utf8', timeout: 10_000 });
  expect(check.status, check.stderr).toBe(0);
  const server = await start(root);
  // Summaries ship in the page; content does not.
  expect(server.html).toContain('"examples":[{"kind":"od-build","path":"od:checkout/home","title":"Checkout","variants":["grid","list"]}');
  expect(server.html).not.toContain('<meta name="od-variant" content="grid">');

  expect((await server.example('od:checkout/home', 'wrong')).status).toBe(403);
  const built = await (await server.example('od:checkout/home')).json() as Record<string, unknown>;
  expect(built).toMatchObject({ kind: 'od-build', variants: [{ id: 'grid' }, { id: 'list' }], tokens: {} });
  expect(await (await server.example('order.json')).json()).toEqual({ kind: 'fixture', format: 'json', data: '{"id": 1}' });
  expect((await server.example('../103-node.md')).status).toBe(404);

  const blocked = await server.status();
  expect(blocked.blockers).toEqual([{ kind: 'variant', targetId: '102', label: 'Choose a variant of Checkout', nodeId: '102', example: 'od:checkout/home' }]);
  expect(blocked.approval.reason).toBe('Choose a variant for each mock with several, by locking its element');

  // Locking chooses the variant on screen, so a lock without one is refused.
  expect((await server.lock('102')).status).toBe(409);
  expect((await server.lock('102', { examples: { 'od:checkout/home': { variant: 'gone' } } })).status).toBe(409);
  expect((await server.lock('102', { examples: { 'od:checkout/home': { variant: 'list', tweaks: {}, states: {} } } })).status).toBe(200);
  const after = await server.status();
  expect(after.blockers).toEqual([]);
  expect(after.locked).toEqual(['102']);
}, 30_000);
