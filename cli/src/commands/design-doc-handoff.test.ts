import { Command } from 'commander';
import type { Server } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { register } from './design-doc.js';
import { createReviewServer } from '../lib/review-server.js';
import { REVIEW_HANDOFF_ID } from '../lib/alignment-review-protocol.js';
import { createNode } from '../lib/nodes.js';
import { EXAMPLE_MAP, EXAMPLE_ROOT } from '../example-design.js';

const context = vi.hoisted(() => ({ root: '', server: undefined as Server | undefined }));
vi.mock('../lib/utils.js', async original => ({
  ...await original<typeof import('../lib/utils.js')>(),
  inProject: (action: (root: string, ...args: unknown[]) => Promise<void>) => (...args: unknown[]) => action(context.root, ...args),
}));
// The worked example's mock lives in its own OpenDesigner folder, copied beside each fixture's map.
vi.mock('../lib/project.js', async original => ({
  ...await original<typeof import('../lib/project.js')>(),
  checkoutRoot: () => context.root,
}));
vi.mock('../lib/review-server.js', async original => ({
  ...await original<typeof import('../lib/review-server.js')>(),
  listenForReview: (server: Server) => { context.server = server; },
}));
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function page(server: Server) {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const url = `http://127.0.0.1:${address.port}/`;
  return { url, html: await (await fetch(url)).text() };
}
function embeddedPrompt(html: string): string | undefined {
  const script = html.match(new RegExp(`<script id="${REVIEW_HANDOFF_ID}" type="application/json">([^]*?)</script>`));
  return script ? JSON.parse(script[1]) as string : undefined;
}

it('serves exact quoted review and authored paths separately from unchanged annotation snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'handoff-'));
  roots.push(root);
  createNode(root, 'example', { title: 'Example', kind: 'destination', label: 'Example', summary: 'Review this design' });
  createNode(root, 'example', { title: 'App', kind: 'element', label: 'App', summary: 'Runs commands', answers: '001', body: '<details>\n<summary>Design element</summary>\n\n```yaml\nkind: component\n```\n</details>' });
  context.root = root;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const command = new Command();
  register(command);
  await command.parseAsync(['design-doc', 'example'], { from: 'user' });
  const server = context.server!;
  const { html, url } = await page(server);
  const version = readdirSync(join(root, 'design-reviews/example'))[0];
  const reviewPath = join(root, 'design-reviews/example', version, 'review.json');
  expect(html).toContain('"orientation":"top-to-bottom"');
  const prompt = embeddedPrompt(html)!;
  expect(prompt).toContain(JSON.stringify(reviewPath));
  expect(prompt).toContain('map "example"');
  expect(prompt).not.toMatch(/untrusted|prompt injection|tool instructions/i);
  expect(prompt).toMatch(/update the map's element nodes/);
  expect(prompt).toMatch(/Never lock an element yourself/);
  const token = html.match(/name="acstack-review-token" content="([^"]+)"/)![1];
  const snapshot = await (await fetch(new URL('/api/annotations', url), { headers: { 'x-review-token': token } })).json() as Record<string, unknown>;
  expect(Object.keys(snapshot).sort()).toEqual(['annotations', 'packVersion', 'revision']);
  expect(snapshot).toEqual(JSON.parse(readFileSync(reviewPath, 'utf8')));
  expect(readdirSync(join(root, 'design-reviews/example', version))).toEqual(['review.json']);
});

it('escapes script terminators and round-trips hostile paths without executable markup', async () => {
  const prompt = 'Read "/tmp/</script><script>alert(1)</script>"&\u2028/review.json"';
  const { html } = await page(createReviewServer({
    html: '<html><head></head><body></body></html>', path: '/api/annotations', mode: 'comments', handoffPrompt: prompt, post: () => ({}),
  }));
  expect(embeddedPrompt(html)).toBe(prompt);
  expect(html).not.toContain('</script><script>alert(1)');
  expect(html).toContain('\\u003c/script\\u003e');
});

it('does not expose a live handoff on legacy pages', async () => {
  const { html } = await page(createReviewServer({ html: '<head></head>', path: '/api/review', handoffPrompt: 'Not live', post: () => ({ prompt: 'Legacy decision' }) }));
  expect(embeddedPrompt(html)).toBeUndefined();
  expect(html).toContain('acstack-review-token');
  expect(html).not.toContain('acstack-review-mode');
});

it.each(['top-to-bottom', 'left-to-right'] as const)('passes %s through live HTML and Markdown', async orientation => {
  const root = mkdtempSync(join(tmpdir(), 'orientation-'));
  roots.push(root);
  cpSync(join(EXAMPLE_ROOT, 'maps'), join(root, 'maps'), { recursive: true });
  cpSync(join(EXAMPLE_ROOT, '.open-designer'), join(root, '.open-designer'), { recursive: true });
  const entry = EXAMPLE_MAP;
  context.root = root;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const command = new Command();
  register(command);
  const markdown = join(root, 'README.md');
  await command.parseAsync(['design-doc', entry, '--orientation', orientation, '--markdown', markdown], { from: 'user' });
  const { html } = await page(context.server!);
  expect(html).toContain(`"orientation":"${orientation}"`);
  expect(readFileSync(markdown, 'utf8')).toContain(`flowchart ${orientation === 'left-to-right' ? 'LR' : 'TD'}`);
});

it('rejects invalid orientation before any filesystem side effects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orientation-'));
  roots.push(root);
  context.root = root;
  const command = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  register(command);
  await expect(command.parseAsync(['design-doc', EXAMPLE_MAP, '--markdown', join(root, 'README.md'), '--orientation', 'diagonal'], { from: 'user' })).rejects.toThrow(/Allowed choices/);
  expect(readdirSync(root)).toEqual([]);
});
